import type { AstroCookies } from 'astro'
import type { FieldErrors, FormConfig } from '@mattthehat/astro-forms/server'
import { parseForm } from '@mattthehat/astro-forms/server'
import type { CmsAdapter, CmsField, CmsFieldMap, CmsId, CmsRow, FilterState, SortSpec } from './types'
import type { CmsFilters } from './filters'
import { filterStatesFrom } from './filters'
import type { Column, RowAction } from './components/types'
import {
  tableColumns, rowToFormValues, rowFromForm, formConfigFor, viewItemsFor,
  selectColumns, searchableColumns, sortableColumns, listableColumns,
  defaultVisibleColumns, applyComputed, exportColumns, toCsv, type ViewItem,
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
  /**
   * Handlers for custom bulk actions, keyed by the BulkAction `key`. Receives
   * every selected id. The built-in 'delete' key is handled for you unless you
   * override it here.
   */
  bulk?: Record<string, (ids: CmsId[], ctx: CmsContext) => HookRedirect>
}

/** A button offered above the table once rows are selected */
export type BulkAction = {
  key: string
  label: string
  /** lucide icon name */
  icon?: string
  variant?: 'primary' | 'danger'
  /** Shown in a confirm() before the POST; `{n}` is replaced with the count */
  confirm?: string
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
  defaultSort?: SortSpec | SortSpec[]
  perPage?: number
  /**
   * Offer a page-size picker with these choices. Only a value from this list is
   * accepted from `?perPage=`, so the query string can't ask for a huge page.
   */
  perPageOptions?: number[]
  /** Offer a CSV export of the current filtered/sorted list */
  csv?: boolean | { filename?: string; maxRows?: number }
  /**
   * Turn deletes into a timestamp write on this column instead of a real
   * DELETE. The list then hides those rows and offers a Deleted view they can
   * be restored from.
   */
  softDelete?: { column: string }
  /** Columns to stamp with the current time on insert and update */
  timestamps?: { created?: string; updated?: string }
  /**
   * Reject an edit whose underlying row changed since the form was loaded,
   * comparing this column (a version number, or an updated-at timestamp).
   */
  concurrency?: { column: string }
  /**
   * Bulk actions offered once rows are selected. Return [] to disable
   * selection entirely. Defaults to a single Delete when `canDelete` allows it.
   */
  bulkActions?: (ctx: CmsContext) => BulkAction[]
  hooks?: CmsHooks<ResourceData<FM>>
  /**
   * Gate creating new rows on the current user. When it returns false the
   * "new" CTA is hidden and the create form/submit is blocked server-side.
   */
  canCreate?: (ctx: CmsContext) => boolean
  /**
   * Gate editing existing rows on the current user. When it returns false the
   * Edit row action and the view screen's Edit CTA are hidden, and the edit
   * form/submit is blocked server-side. Use for read-only resources.
   */
  canEdit?: (ctx: CmsContext) => boolean
  /**
   * Gate deleting rows on the current user. When it returns false the Delete
   * row action is hidden and the delete POST is blocked server-side.
   */
  canDelete?: (ctx: CmsContext) => boolean
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
      /** The full ordering, most significant first */
      order: SortSpec[]
      actions: RowAction[]
      columns: Column[]
      canCreate: boolean
      /** Name of the id column, so the table can value its selection checkboxes */
      idColumn: string
      /** Every column that could be shown, for the column picker */
      allColumns: { key: string; label: string; hidden: boolean }[]
      /** The keys currently shown */
      visibleColumns: string[]
      /** Page-size choices; empty when no picker was configured */
      perPageOptions: number[]
      /** Bulk actions available; empty means no selection checkboxes */
      bulkActions: BulkAction[]
      /** Whether to offer the CSV export button */
      csv: boolean
      /** Soft delete is configured, so a Deleted/Active toggle is available */
      softDelete: boolean
      /** Currently showing soft-deleted rows */
      trash: boolean
    }
  | {
      mode: 'form'
      formMode: 'create' | 'edit'
      form: ReturnType<typeof formConfigFor>
      values: Record<string, string | boolean>
      errors: FieldErrors
      serverError?: string
    }
  | { mode: 'view'; id: CmsId; items: ViewItem[]; canEdit: boolean }

/**
 * A ready-made Response the page should return as-is — currently only the CSV
 * export. Pages handle it with `if ('response' in result) return result.response`.
 */
export type CmsResult = { redirect: string } | { response: Response } | { state: CmsState }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Reads `?id=` while preserving non-numeric ids (UUIDs, slugs). Digit-only
 * values become numbers so integer-keyed tables behave exactly as before;
 * anything else — including ids too long to hold as a safe integer, e.g.
 * bigint keys — stays a string rather than being mangled by Number().
 */
const parseId = (raw: string | null): CmsId | null => {
  if (raw === null) return null
  const value = raw.trim()
  if (value === '') return null
  return /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : value
}

/**
 * Reads the ordering from `?sort=`. Accepts the multi-column form
 * (`city:asc,likes:desc`) and the original single-column form (`?sort=city&dir=asc`).
 * Unknown or non-sortable columns are dropped, so the query string can never
 * name a column the config didn't mark sortable.
 */
const parseOrder = (params: URLSearchParams, sortable: string[], fallback: SortSpec[]): SortSpec[] => {
  const raw = params.get('sort')
  if (!raw) return fallback

  const dirParam = params.get('dir')
  const order: SortSpec[] = []
  const seen = new Set<string>()

  for (const term of raw.split(',')) {
    const [column, dir] = term.split(':')
    const key = column?.trim()
    if (!key || seen.has(key) || !sortable.includes(key)) continue
    seen.add(key)
    // `?dir=` applies to the single-column form only
    const d = dir?.trim() ?? (order.length === 0 ? dirParam : null)
    order.push({ column: key, dir: d === 'desc' ? 'desc' : 'asc' })
  }

  return order.length > 0 ? order : fallback
}

/** Page size, restricted to the configured choices so `?perPage=` can't ask for the whole table */
const parsePerPage = (params: URLSearchParams, options: number[], fallback: number): number => {
  const requested = Number(params.get('perPage'))
  return options.includes(requested) ? requested : fallback
}

/**
 * Visible column keys from `?cols=`, intersected with what's actually listable.
 * Accepts both the comma form (`?cols=a,b`, which is what a shared link looks
 * like) and the repeated form (`?cols=a&cols=b`), which is what the column
 * picker's checkbox group actually submits.
 */
const parseColumns = (params: URLSearchParams, listable: string[], fallback: string[]): string[] => {
  const raw = params.getAll('cols')
  if (raw.length === 0) return fallback
  const chosen = [...new Set(raw.flatMap((value) => value.split(',')).map((c) => c.trim()))]
    .filter((c) => listable.includes(c))
  // An empty or entirely bogus selection would render a table with no columns
  return chosen.length > 0 ? chosen : fallback
}

/**
 * Normalises a concurrency column's value into a short token safe to round-trip
 * through the form's action URL. Dates go via epoch millis so formatting
 * differences can't produce a spurious mismatch.
 */
const versionToken = (value: unknown): string =>
  value instanceof Date ? String(value.getTime()) : String(value ?? '')

/**
 * Points an edit form at a URL carrying the row's version token, so the token
 * comes back with the submission without needing a hidden field (which would
 * mean reading the request body before parseForm gets it).
 */
const versionedForm = (form: FormConfig, basePath: string, id: CmsId, token: string): FormConfig => ({
  ...form,
  action: `${basePath}?action=edit&id=${encodeURIComponent(String(id))}&_v=${encodeURIComponent(token)}`,
})

/** Naive English pluralisation — enough for resource nouns; override via `plural` */
export const pluralise = (s: string): string => {
  if (/[^aeiou]y$/i.test(s)) return `${s.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/i.test(s)) return `${s}es`
  return `${s}s`
}

export const resourcePlural = (config: ResourceConfig): string => config.plural ?? pluralise(config.singular)

/**
 * The list URL to return to after a row mutation, keeping the search, sort,
 * paging and filter state the user was looking at. Only `action`/`id` are
 * dropped, so filter params (whose keys come from the resource config) survive.
 */
const listPath = (basePath: string, params: URLSearchParams): string => {
  const keep = new URLSearchParams(params)
  keep.delete('action')
  keep.delete('id')
  const query = keep.toString()
  return query ? `${basePath}?${query}` : basePath
}

/** Ids reach the URL escaped, so slug/UUID keys survive the round trip */
const idParam = (row: CmsRow, idColumn: string) => encodeURIComponent(String(row[idColumn]))

const defaultActions = (
  config: Pick<ResourceConfig, 'basePath' | 'idColumn' | 'singular'>,
  canEdit: boolean,
  canDelete: boolean,
  trash = false
): RowAction[] => [
  // Deleted rows are restored, not edited
  ...(trash && canDelete
    ? [{
        label: 'Restore',
        icon: 'lucide:rotate-ccw',
        formAction: (row) => `${config.basePath}?action=restore&trash=1&id=${idParam(row, config.idColumn)}`,
      } as RowAction]
    : []),
  // Edit is dropped for read-only resources (canEdit === false)
  ...(canEdit && !trash
    ? [{ label: 'Edit', icon: 'lucide:pencil', href: (row) => `${config.basePath}?action=edit&id=${idParam(row, config.idColumn)}` } as RowAction]
    : []),
  // Likewise Delete, for resources the user may not remove from
  ...(canDelete
    ? [{
        label: trash ? 'Delete permanently' : 'Delete',
        icon: 'lucide:trash-2',
        variant: 'danger',
        // trash=1 tells the engine this is the real delete, not another soft one
        formAction: (row) => `${config.basePath}?action=delete${trash ? '&trash=1' : ''}&id=${idParam(row, config.idColumn)}`,
        confirm: trash
          ? `Permanently delete this ${config.singular}? This cannot be undone.`
          : `Delete this ${config.singular}?`,
      } as RowAction]
    : []),
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
  const { table, idColumn, basePath, singular, fields, hooks, softDelete, timestamps, concurrency } = config
  type D = ResourceData<FM>

  const { request, url, adapter } = ctx
  const params = url.searchParams
  // The soft-delete and concurrency columns are read back, so they must be selected
  const select = [...new Set([
    ...selectColumns(fields, idColumn),
    ...(softDelete ? [softDelete.column] : []),
    ...(concurrency ? [concurrency.column] : []),
  ])]
  const cms: CmsContext = { request, url, user: ctx.user ?? null, flash: (items) => setFlash(ctx.cookies, items) }
  const action = params.get('action') // null | 'new' | 'edit' | 'view' | 'delete' | 'restore' | 'bulk' | 'export' | custom
  const id = parseId(params.get('id'))
  const isFormView = action === 'new' || (action === 'edit' && id !== null)
  const post = request.method === 'POST'
  const canCreate = config.canCreate ? config.canCreate(cms) : true
  const canEdit = config.canEdit ? config.canEdit(cms) : true
  const canDelete = config.canDelete ? config.canDelete(cms) : true
  /** Viewing the soft-deleted rows rather than the live ones */
  const trash = softDelete !== undefined && params.get('trash') === '1'

  /** Whether a row read back from the adapter is soft-deleted */
  const isDeleted = (row: CmsRow): boolean =>
    softDelete !== undefined && row[softDelete.column] !== null && row[softDelete.column] !== undefined && row[softDelete.column] !== ''

  const bulkActions: BulkAction[] = config.bulkActions
    ? config.bulkActions(cms)
    : canDelete
      ? [{
          key: 'delete',
          label: trash ? 'Delete permanently' : 'Delete selected',
          icon: 'lucide:trash-2',
          variant: 'danger',
          confirm: `Delete {n} ${(config.plural ?? pluralise(singular)).toLowerCase()}? This cannot be undone.`,
        }]
      : []

  // Block the create form (GET render and POST submit) when not permitted
  if (action === 'new' && !canCreate) {
    cms.flash([{ variant: 'error', message: `You don’t have permission to add a ${singular}.` }])
    return { redirect: basePath }
  }

  // Block the edit form (GET render and POST submit) when not permitted
  if (action === 'edit' && !canEdit) {
    cms.flash([{ variant: 'error', message: `You don’t have permission to edit this ${singular}.` }])
    return { redirect: basePath }
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  if (post && action && hooks?.actions?.[action]) {
    return { redirect: await hooks.actions[action](id, cms) }
  }

  if (post && action === 'delete' && id !== null) {
    // Blocked server-side, not just hidden in the UI — the POST is forgeable
    if (!canDelete) {
      cms.flash([{ variant: 'error', message: `You don’t have permission to delete this ${singular}.` }])
      return { redirect: basePath }
    }
    const blocked = await hooks?.beforeDelete?.(id, cms)
    if (typeof blocked === 'string') return { redirect: blocked }
    // In the trash view Delete means "really delete"; elsewhere soft delete stamps the column
    if (softDelete && !trash) {
      await adapter.update(table, idColumn, id, { [softDelete.column]: new Date() })
    } else {
      await adapter.remove(table, idColumn, id)
    }
    const after = await hooks?.afterDelete?.(id, cms)
    if (typeof after === 'string') return { redirect: after }
    cms.flash([{ variant: 'success', message: `${cap(singular)} deleted.` }])
    return { redirect: listPath(basePath, params) }
  }

  if (post && action === 'restore' && id !== null && softDelete) {
    if (!canDelete) {
      cms.flash([{ variant: 'error', message: `You don’t have permission to restore this ${singular}.` }])
      return { redirect: basePath }
    }
    await adapter.update(table, idColumn, id, { [softDelete.column]: null })
    cms.flash([{ variant: 'success', message: `${cap(singular)} restored.` }])
    return { redirect: listPath(basePath, params) }
  }

  if (post && action === 'bulk') {
    // No parseForm here, so the body is ours to read directly
    const body = await request.formData()
    const ids = body.getAll('ids').map((v) => parseId(String(v))).filter((v): v is CmsId => v !== null)
    const key = String(body.get('bulk') ?? '')
    const chosen = bulkActions.find((a) => a.key === key)

    if (!chosen || ids.length === 0) return { redirect: listPath(basePath, params) }

    const custom = hooks?.bulk?.[key]
    if (custom) {
      const r = await custom(ids, cms)
      if (typeof r === 'string') return { redirect: r }
      return { redirect: listPath(basePath, params) }
    }

    if (key === 'delete') {
      if (softDelete && !trash) {
        for (const each of ids) await adapter.update(table, idColumn, each, { [softDelete.column]: new Date() })
      } else if (adapter.removeMany) {
        await adapter.removeMany(table, idColumn, ids)
      } else {
        // Adapters may skip removeMany; one delete each is slower but correct
        for (const each of ids) await adapter.remove(table, idColumn, each)
      }
      cms.flash([{ variant: 'success', message: `${ids.length} ${(ids.length === 1 ? singular : config.plural ?? pluralise(singular)).toLowerCase()} deleted.` }])
    }

    return { redirect: listPath(basePath, params) }
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
        const now = new Date()
        if (creating) {
          if (timestamps?.created) row[timestamps.created] = now
          if (timestamps?.updated) row[timestamps.updated] = now
          if (hooks?.beforeInsert) row = await hooks.beforeInsert(row, cms)
          const newId = await adapter.create(table, row)
          const r = await hooks?.afterInsert?.(newId, data, cms)
          if (typeof r === 'string') return { redirect: r }
        } else if (id !== null) {
          // Refuse the write if someone else saved this row since the form loaded
          if (concurrency) {
            const current = await adapter.findOne(table, idColumn, id, select)
            if (!current) {
              cms.flash([{ variant: 'warning', message: `That ${singular} no longer exists.` }])
              return { redirect: basePath }
            }
            if (versionToken(current[concurrency.column]) !== (params.get('_v') ?? '')) {
              return {
                state: {
                  mode: 'form',
                  formMode: 'edit',
                  form: versionedForm(formCfg, basePath, id, versionToken(current[concurrency.column])),
                  values: result.data as Record<string, string | boolean>,
                  errors: {},
                  serverError: `This ${singular} was changed by someone else while you were editing. Reload to see the current version — saving now would overwrite their changes.`,
                },
              }
            }
          }
          if (timestamps?.updated) row[timestamps.updated] = now
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

    let form = formCfg
    // Prefill an edit form from the DB (unless a failed submit already set values)
    if (!creating && id !== null && Object.keys(values).length === 0) {
      const row = await adapter.findOne(table, idColumn, id, select)
      if (!row || isDeleted(row)) {
        cms.flash([{ variant: 'warning', message: `That ${singular} no longer exists.` }])
        return { redirect: basePath }
      }
      values = rowToFormValues(row, fields)
      if (concurrency) form = versionedForm(formCfg, basePath, id, versionToken(row[concurrency.column]))
    } else if (!creating && id !== null && concurrency) {
      // Re-rendering after a validation failure — keep the token the form posted with
      form = versionedForm(formCfg, basePath, id, params.get('_v') ?? '')
    }

    return { state: { mode: 'form', formMode: creating ? 'create' : 'edit', form, values, errors, serverError } }
  }

  // ── View (read-only) ─────────────────────────────────────────────────────────

  if (action === 'view' && id !== null) {
    const row = await adapter.findOne(table, idColumn, id, select)
    if (!row || isDeleted(row)) {
      cms.flash([{ variant: 'warning', message: `That ${singular} no longer exists.` }])
      return { redirect: basePath }
    }
    return { state: { mode: 'view', id, items: viewItemsFor(applyComputed(row, fields), fields), canEdit } }
  }

  // ── List ─────────────────────────────────────────────────────────────────────

  const filters = typeof config.filters === 'function' ? await config.filters() : config.filters ?? []
  const searchColumns = searchableColumns(fields)
  const sortable = sortableColumns(fields)
  const page = Math.max(1, Number(params.get('page')) || 1)

  const q = params.get('q')?.trim()
  const search = q && searchColumns.length > 0 ? { columns: searchColumns, term: q } : undefined

  // Only allow ordering by a column the config marks sortable
  const fallbackOrder: SortSpec[] = config.defaultSort
    ? Array.isArray(config.defaultSort) ? config.defaultSort : [config.defaultSort]
    : [{ column: idColumn, dir: 'asc' }]
  const order = parseOrder(params, sortable, fallbackOrder)

  const perPageOptions = config.perPageOptions ?? []
  const perPage = parsePerPage(params, perPageOptions, config.perPage ?? 10)

  const listable = listableColumns(fields)
  const visibleColumns = parseColumns(params, listable.map((c) => c.key), defaultVisibleColumns(fields))

  // Soft delete rides on the existing `nonempty` filter, so every adapter that
  // implements the interface supports it without knowing the concept exists
  const listFilters: FilterState[] = [
    ...filterStatesFrom(params, filters),
    ...(softDelete ? [{ type: 'nonempty' as const, column: softDelete.column, state: (trash ? 'set' : 'unset') as 'set' | 'unset' }] : []),
  ]

  const csvEnabled = config.csv !== undefined && config.csv !== false

  // The export reuses the current search/filter/order — just without paging
  if (action === 'export' && csvEnabled) {
    const opts = typeof config.csv === 'object' ? config.csv : {}
    const { rows: all } = await adapter.findMany({
      table, idColumn, columns: select, search, filters: listFilters,
      sort: order[0], order, limit: opts.maxRows ?? 10000, offset: 0,
    })
    const csv = toCsv(all.map((row) => applyComputed(row, fields)), exportColumns(fields))
    const filename = opts.filename ?? `${config.plural ?? pluralise(singular)}.csv`
    return {
      response: new Response(csv, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
        },
      }),
    }
  }

  const { rows, total } = await adapter.findMany({
    table,
    idColumn,
    columns: select,
    search,
    filters: listFilters,
    // `sort` mirrors `order[0]` so adapters predating multi-column sort still work
    sort: order[0],
    order,
    limit: perPage,
    offset: (page - 1) * perPage,
  })

  return {
    state: {
      mode: 'list',
      listing: { rows: rows.map((row) => applyComputed(row, fields)), page, total, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) },
      filters,
      searchColumns,
      order,
      actions: config.rowActions ? config.rowActions(cms) : defaultActions(config, canEdit, canDelete, trash),
      columns: tableColumns(fields, visibleColumns),
      canCreate,
      idColumn,
      allColumns: listable,
      visibleColumns,
      perPageOptions,
      bulkActions,
      csv: csvEnabled,
      softDelete: softDelete !== undefined,
      trash,
    },
  }
}
