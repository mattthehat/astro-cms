import type { FieldConfig, FieldErrors } from '@mattthehat/astro-forms/server'
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
  /**
   * Derive this column's value from the whole row instead of reading it from
   * the DB. Implies `virtual` — nothing is selected or persisted for it — so
   * it is how a virtual field earns a place in the list table or view screen.
   */
  compute?: (row: CmsRow) => unknown
  /** Hide this column from the list by default; users re-show it via the column picker */
  hidden?: boolean
  /** Exclude from the CSV export even when listed */
  export?: boolean
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

/** One ordering term */
export type SortSpec = { column: string; dir: 'asc' | 'desc' }

/** Everything an adapter needs to produce one page of list results */
export type ListQuery = {
  table: string
  idColumn: string
  /** SELECT list: id plus every non-virtual field */
  columns: string[]
  /** Free-text search over these columns (already trimmed, non-empty) */
  search?: { columns: string[]; term: string }
  filters: FilterState[]
  /**
   * The primary ordering. Always mirrors `order[0]`, so an adapter written
   * before multi-column sort existed keeps working — it just sorts by the
   * most significant column only.
   */
  sort?: SortSpec
  /** The full ordering, most significant first. Prefer this over `sort`. */
  order?: SortSpec[]
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
  /**
   * Optional bulk delete. Implement it to remove a selection in one statement;
   * without it the engine falls back to `remove` per id, which is correct but
   * issues one query each.
   */
  removeMany?(table: string, idColumn: string, ids: CmsId[]): Promise<void>
  /** Turn a thrown persistence error into friendly field/form errors */
  mapError(err: unknown, fields: CmsFieldMap): MappedError
}
