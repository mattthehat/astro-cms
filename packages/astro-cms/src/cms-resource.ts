import type { AstroCookies } from 'astro'
import type { FieldErrors } from '@mattthehat/astro-forms/server'
import { parseForm } from '@mattthehat/astro-forms/server'
import type { CmsAdapter, CmsField, CmsFieldMap, CmsId, CmsRow } from './types'
import type { CmsFilters } from './filters'
import { filterStatesFrom } from './filters'
import type { Column, RowAction } from './components/types'
import {
  tableColumns, rowToFormValues, rowFromForm, formConfigFor, viewItemsFor,
  selectColumns, searchableColumns, sortableColumns, type ViewItem,
} from './cms'
import { setFlash, type FlashItem } from './flash'

export type { FlashItem } from './flash'

/** The signed-in user, if your app has one — passed through to hooks and gates */
export type CmsUser = { id: CmsId; [key: string]: unknown }

/** Request context handed to every hook */
export type CmsContext = {
  request: Request
  url: URL
  user: CmsUser | null
  /** Queue flash message(s) to show after the redirect */
  flash: (items: FlashItem[]) => void
}

// Best-effort form-value types for hook `data` (parsed values are strings/bools)
type FieldValueType<F extends CmsField> =
  F['type'] extends 'checkbox' ? (F['options'] extends object[] ? string[] : boolean)
  : F['type'] extends 'switch' ? boolean
  : F['type'] extends 'select' ? (F['multiple'] extends true ? string[] : string)
  : string
export type ResourceData<FM extends CmsFieldMap> = { [K in keyof FM]: FieldValueType<FM[K]> }

/** Either nothing (use the default redirect) or a path to redirect to instead */
type HookRedirect = void | string | Promise<void | string>

/**
 * Lifecycle hooks wrap the default persistence operations. `before*` can
 * transform the row (insert/update) or short-circuit (delete, by returning a
 * redirect path). `after*` can queue flash and/or return a redirect to
 * override the default.
 */
export type CmsHooks<D> = {
  beforeInsert?: (row: CmsRow, ctx: CmsContext) => CmsRow | Promise<CmsRow>
  afterInsert?: (id: CmsId, data: D, ctx: CmsContext) => HookRedirect
  beforeUpdate?: (row: CmsRow, id: CmsId, ctx: CmsContext) => CmsRow | Promise<CmsRow>
  afterUpdate?: (id: CmsId, data: D, ctx: CmsContext) => HookRedirect
  beforeDelete?: (id: CmsId, ctx: CmsContext) => HookRedirect
  afterDelete?: (id: CmsId, ctx: CmsContext) => HookRedirect
  /** Custom POST handlers keyed by `?action=`, each returning a redirect path */
  actions?: Record<string, (id: CmsId | null, ctx: CmsContext) => string | Promise<string>>
}

/** One config object drives the whole resource: list, forms, view, persistence. */
export type ResourceConfig<FM extends CmsFieldMap = CmsFieldMap> = {
  table: string
  idColumn: string
  /** Route this resource lives at, e.g. '/admin/gigs' */
  basePath: string
  /** Lower-case singular noun, e.g. 'gig'. Plural is derived unless overridden. */
  singular: string
  plural?: string
  /** Field definitions — drive the forms, table columns, view, search and sort */
  fields: FM
  filters?: CmsFilters | (() => CmsFilters | Promise<CmsFilters>)
  defaultSort?: { column: string; dir: 'asc' | 'desc' }
  perPage?: number
  hooks?: CmsHooks<ResourceData<FM>>
  /**
   * Gate creating new rows on the current user. When it returns false the
   * "new" CTA is hidden and the create form/submit is blocked server-side.
   */
  canCreate?: (ctx: CmsContext) => boolean
  /** Override the row actions; receives request context (for the current user) */
  rowActions?: (ctx: CmsContext) => RowAction[]
  labels?: { newHeading?: string; newCta?: string; createSubmit?: string; createNote?: string }
}

/** Identity helper so a resource's field types are inferred for its hooks */
export const defineResource = <FM extends CmsFieldMap>(config: ResourceConfig<FM>): ResourceConfig<FM> => config

/** Everything runCmsResource needs from the current request, plus the adapter */
export type CmsRunContext = {
  request: Request
  url: URL
  user?: CmsUser | null
  cookies: AstroCookies
  adapter: CmsAdapter
}

export type ListingData = {
  rows: CmsRow[]
  page: number
  totalPages: number
  total: number
  perPage: number
}

export type CmsState =
  | {
      mode: 'list'
      listing: ListingData
      filters: CmsFilters
      searchColumns: string[]
      sort: { column: string; dir: 'asc' | 'desc' }
      actions: RowAction[]
      columns: Column[]
      canCreate: boolean
    }
  | {
      mode: 'form'
      formMode: 'create' | 'edit'
      form: ReturnType<typeof formConfigFor>
      values: Record<string, string | boolean>
      errors: FieldErrors
      serverError?: string
    }
  | { mode: 'view'; id: number; items: ViewItem[] }

export type CmsResult = { redirect: string } | { state: CmsState }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Naive English pluralisation — enough for resource nouns; override via `plural` */
export const pluralise = (s: string): string => {
  if (/[^aeiou]y$/i.test(s)) return `${s.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/i.test(s)) return `${s}es`
  return `${s}s`
}

export const resourcePlural = (config: ResourceConfig): string => config.plural ?? pluralise(config.singular)

const defaultActions = (config: Pick<ResourceConfig, 'basePath' | 'idColumn' | 'singular'>): RowAction[] => [
  { label: 'Edit', icon: 'lucide:pencil', href: (row) => `${config.basePath}?action=edit&id=${row[config.idColumn]}` },
  {
    label: 'Delete',
    icon: 'lucide:trash-2',
    variant: 'danger',
    formAction: (row) => `${config.basePath}?action=delete&id=${row[config.idColumn]}`,
    confirm: `Delete this ${config.singular}? This cannot be undone.`,
  },
]

/**
 * Runs a CMS resource for the current request. Handles delete/create/edit and
 * custom actions (returning a redirect) or returns the view state for the
 * list/form/view. All logic lives here so resource pages stay declarative.
 */
export const runCmsResource = async <FM extends CmsFieldMap>(
  config: ResourceConfig<FM>,
  ctx: CmsRunContext
): Promise<CmsResult> => {
  const { table, idColumn, basePath, singular, fields, hooks } = config
  const perPage = config.perPage ?? 10
  const select = selectColumns(fields, idColumn)
  type D = ResourceData<FM>

  const { request, url, adapter } = ctx
  const cms: CmsContext = { request, url, user: ctx.user ?? null, flash: (items) => setFlash(ctx.cookies, items) }
  const action = url.searchParams.get('action') // null | 'new' | 'edit' | 'view' | 'delete' | custom
  const id = Number(url.searchParams.get('id')) || null
  const isFormView = action === 'new' || (action === 'edit' && id !== null)
  const post = request.method === 'POST'
  const canCreate = config.canCreate ? config.canCreate(cms) : true

  // Block the create form (GET render and POST submit) when not permitted
  if (action === 'new' && !canCreate) {
    cms.flash([{ variant: 'error', message: `You don’t have permission to add a ${singular}.` }])
    return { redirect: basePath }
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  if (post && action && hooks?.actions?.[action]) {
    return { redirect: await hooks.actions[action](id, cms) }
  }

  if (post && action === 'delete' && id) {
    const blocked = await hooks?.beforeDelete?.(id, cms)
    if (typeof blocked === 'string') return { redirect: blocked }
    await adapter.remove(table, idColumn, id)
    const after = await hooks?.afterDelete?.(id, cms)
    if (typeof after === 'string') return { redirect: after }
    cms.flash([{ variant: 'success', message: `${cap(singular)} deleted.` }])
    return { redirect: basePath }
  }

  if (isFormView) {
    const creating = action === 'new'
    const formCfg = formConfigFor(fields, creating ? 'add' : 'edit')
    let values: Record<string, string | boolean> = {}
    let errors: FieldErrors = {}
    let serverError: string | undefined

    const result = await parseForm({ request, config: formCfg })
    if (result?.success) {
      const data = result.data as unknown as D
      try {
        let row = rowFromForm(result.data, fields)
        if (creating) {
          if (hooks?.beforeInsert) row = await hooks.beforeInsert(row, cms)
          const newId = await adapter.create(table, row)
          const r = await hooks?.afterInsert?.(newId, data, cms)
          if (typeof r === 'string') return { redirect: r }
        } else if (id) {
          if (hooks?.beforeUpdate) row = await hooks.beforeUpdate(row, id, cms)
          await adapter.update(table, idColumn, id, row)
          const r = await hooks?.afterUpdate?.(id, data, cms)
          if (typeof r === 'string') return { redirect: r }
        }
        cms.flash([{ variant: 'success', message: `${cap(singular)} saved.` }])
        return { redirect: basePath }
      } catch (err) {
        const mapped = adapter.mapError(err, fields)
        errors = mapped.errors ?? {}
        serverError = mapped.message
        values = result.data as Record<string, string | boolean>
      }
    } else if (result) {
      errors = result.errors
      values = result.data as Record<string, string | boolean>
    }

    // Prefill an edit form from the DB (unless a failed submit already set values)
    if (!creating && id && Object.keys(values).length === 0) {
      const row = await adapter.findOne(table, idColumn, id, select)
      if (!row) {
        cms.flash([{ variant: 'warning', message: `That ${singular} no longer exists.` }])
        return { redirect: basePath }
      }
      values = rowToFormValues(row, fields)
    }

    return { state: { mode: 'form', formMode: creating ? 'create' : 'edit', form: formCfg, values, errors, serverError } }
  }

  // ── View (read-only) ─────────────────────────────────────────────────────────

  if (action === 'view' && id) {
    const row = await adapter.findOne(table, idColumn, id, select)
    if (!row) {
      cms.flash([{ variant: 'warning', message: `That ${singular} no longer exists.` }])
      return { redirect: basePath }
    }
    return { state: { mode: 'view', id, items: viewItemsFor(row, fields) } }
  }

  // ── List ─────────────────────────────────────────────────────────────────────

  const filters = typeof config.filters === 'function' ? await config.filters() : config.filters ?? []
  const searchColumns = searchableColumns(fields)
  const sortable = sortableColumns(fields)
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)

  const q = url.searchParams.get('q')?.trim()
  const search = q && searchColumns.length > 0 ? { columns: searchColumns, term: q } : undefined

  // Only allow ordering by a column the config marks sortable
  const sortParam = url.searchParams.get('sort')
  const dirParam = url.searchParams.get('dir')
  const column = sortParam && sortable.includes(sortParam) ? sortParam : config.defaultSort?.column ?? idColumn
  const dir: 'asc' | 'desc' = dirParam === 'asc' || dirParam === 'desc' ? dirParam : config.defaultSort?.dir ?? 'asc'

  const { rows, total } = await adapter.findMany({
    table,
    idColumn,
    columns: select,
    search,
    filters: filterStatesFrom(url.searchParams, filters),
    sort: { column, dir },
    limit: perPage,
    offset: (page - 1) * perPage,
  })

  return {
    state: {
      mode: 'list',
      listing: { rows, page, total, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) },
      filters,
      searchColumns,
      sort: { column, dir },
      actions: config.rowActions ? config.rowActions(cms) : defaultActions(config),
      columns: tableColumns(fields),
      canCreate,
    },
  }
}
