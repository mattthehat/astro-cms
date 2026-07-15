import type { FieldConfig, FieldErrors } from '@mattthehat/astro-forms'
import type { CellVariant, Decorator } from './components/types'

// ── Field configuration (extends astro-forms) ────────────────────────────────

/** Named formatters for list/view values */
export type ColumnFormat = 'text' | 'date' | 'datetime' | 'bool' | 'currency'

/** Per-column list configuration when `list` is an object rather than `true` */
export type ColumnConfig = {
  label?: string
  format?: ColumnFormat
  /** Wrap the value in a pill/badge of this colour */
  pill?: CellVariant
  prefix?: string
  suffix?: string
  /** Full control over the rendered cell — overrides format/pill/prefix/suffix */
  decorate?: Decorator
}

/**
 * A CMS field: an astro-forms field plus the CMS-only flags that drive the
 * list table, view screen, search and sort.
 */
export type CmsField = FieldConfig & {
  /** Show as a list column; pass a ColumnConfig to control the rendering */
  list?: true | ColumnConfig
  /** Include on the create form (default true) */
  add?: boolean
  /** Include on the edit form (default true) */
  edit?: boolean
  /** Include on the view screen (default true) */
  view?: boolean
  /** Not a DB column — excluded from SELECTs and persisted rows */
  virtual?: boolean
  /** Column participates in the free-text search */
  search?: boolean
  /** Column header renders as a sort toggle */
  sort?: boolean
}

export type CmsFieldMap = Record<string, CmsField>

// ── Adapter interface ─────────────────────────────────────────────────────────

export type CmsRow = Record<string, unknown>

export type CmsId = number | string

/**
 * DB-agnostic filter state, parsed from URLSearchParams by the engine.
 * Adapters translate these into their own query language. `column` always
 * comes from trusted resource config, never from user input.
 */
export type FilterState =
  | { type: 'dateRange'; column: string; from?: string; to?: string }
  | { type: 'present'; column: string }
  | { type: 'bool'; column: string }
  | { type: 'select'; column: string; value: string }
  | { type: 'nonempty'; column: string; state: 'set' | 'unset' }

/** Everything an adapter needs to produce one page of list results */
export type ListQuery = {
  table: string
  idColumn: string
  /** SELECT list: id plus every non-virtual field */
  columns: string[]
  /** Free-text search over these columns (already trimmed, non-empty) */
  search?: { columns: string[]; term: string }
  filters: FilterState[]
  sort?: { column: string; dir: 'asc' | 'desc' }
  limit: number
  offset: number
}

/** A persistence error mapped to field-level errors and/or a form-level message */
export type MappedError = {
  errors?: FieldErrors
  message?: string
}

/**
 * The persistence seam. The engine only ever talks to this interface, so the
 * core stays DB-agnostic; ship or write an adapter per backend.
 */
export interface CmsAdapter {
  findMany(q: ListQuery): Promise<{ rows: CmsRow[]; total: number }>
  findOne(table: string, idColumn: string, id: CmsId, columns: string[]): Promise<CmsRow | null>
  /** Returns the new row's id */
  create(table: string, data: CmsRow): Promise<CmsId>
  update(table: string, idColumn: string, id: CmsId, data: CmsRow): Promise<void>
  remove(table: string, idColumn: string, id: CmsId): Promise<void>
  /** Turn a thrown persistence error into friendly field/form errors */
  mapError(err: unknown, fields: CmsFieldMap): MappedError
}
