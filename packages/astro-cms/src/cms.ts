import type { FormConfig } from '@mattthehat/astro-forms/server'
import type { CmsField, CmsFieldMap, ColumnFormat, ColumnConfig } from './types'
import type { Column, CellValue, CellContent, Decorator } from './components/types'

const pad = (n: number) => String(n).padStart(2, '0')

const text = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v))

const formatters: Record<ColumnFormat, (v: unknown) => CellValue> = {
  text,
  date: v =>
    v instanceof Date ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(v) : text(v),
  datetime: v =>
    v instanceof Date
      ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(v)
      : text(v),
  // Booleans render as a tick or cross icon rather than words
  bool: v =>
    v
      ? { icon: 'lucide:check', iconVariant: 'success', label: 'Yes' }
      : { icon: 'lucide:x', iconVariant: 'error', label: 'No' },
  currency: v =>
    v === null || v === undefined
      ? '—'
      : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(v)),
}

/** Builds a decorator from a list-column config: a named format, then optional pill/prefix/suffix */
const buildDecorator = (col: ColumnConfig): Decorator => {
  if (col.decorate) return col.decorate
  return (value) => {
    const base = formatters[col.format ?? 'text'](value)
    if (!col.pill && !col.prefix && !col.suffix) return base
    const content: CellContent = typeof base === 'string' ? { text: base } : { ...base }
    if (col.prefix) content.prefix = col.prefix
    if (col.suffix) content.suffix = col.suffix
    if (col.pill) content.pill = col.pill
    return content
  }
}

const listConfig = (field: CmsField): ColumnConfig => (typeof field.list === 'object' ? field.list : {})

/** Derives Table columns from the fields marked with `list`. Heading falls back to the field label. */
export const tableColumns = (fields: CmsFieldMap): Column[] =>
  Object.entries(fields)
    .filter(([, field]) => field.list)
    .map(([key, field]) => {
      const col = listConfig(field)
      return {
        key,
        label: col.label ?? field.label ?? key,
        format: buildDecorator(col),
        // Boolean columns are icon-only, so centre the whole column incl. header
        align: col.format === 'bool' ? ('centre' as const) : undefined,
        sortable: field.sort ?? false,
      }
    })

// ── Form ⇄ row mapping ───────────────────────────────────────────────────────

/** Builds the FormConfig for a given mode from the resource fields */
export const formConfigFor = (fields: CmsFieldMap, mode: 'add' | 'edit'): FormConfig => {
  const included = Object.entries(fields).filter(([, f]) =>
    mode === 'add' ? f.add !== false : f.edit !== false
  )
  const hasFile = included.some(([, f]) => f.type === 'file')
  return {
    novalidate: true,
    ...(hasFile ? { enctype: 'multipart/form-data' as const } : {}),
    fields: Object.fromEntries(included),
  }
}

/** Coerces a single parsed form value into the DB representation for its field type */
const coerceValue = (value: unknown, field: CmsField): unknown => {
  if (field.type === 'checkbox' || field.type === 'switch') return value ? 1 : 0
  if (field.type === 'number' || field.type === 'range') return value === '' || value == null ? null : Number(value)
  if (typeof value === 'string') {
    let v = value.trim()
    if (field.type === 'email') v = v.toLowerCase()
    // datetime-local "2026-09-01T20:00" → MySQL "2026-09-01 20:00:00"
    if (field.type === 'datetime-local') return v ? v.replace('T', ' ') + (v.length === 16 ? ':00' : '') : null
    return v === '' ? null : v
  }
  return value
}

/** Maps parsed form data to a DB row using each field's type (replaces hand-written toRow) */
export const rowFromForm = (data: Record<string, unknown>, fields: CmsFieldMap): Record<string, unknown> => {
  const row: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    const field = fields[key]
    if (!field || field.virtual) continue
    row[key] = coerceValue(value, field)
  }
  return row
}

/** Converts a DB value into what the matching HTML input expects */
export const toInputValue = (v: unknown, type?: CmsField['type']): string => {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const date = `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
    const time = `${pad(v.getHours())}:${pad(v.getMinutes())}`
    if (type === 'date') return date
    if (type === 'time') return time
    if (type === 'datetime-local') return `${date}T${time}`
    return `${date} ${time}`
  }
  return String(v)
}

/** Maps a DB row onto Form `values` using the field types in the config */
export const rowToFormValues = (
  row: Record<string, unknown>,
  fields: CmsFieldMap
): Record<string, string | boolean> => {
  const values: Record<string, string | boolean> = {}
  for (const [key, field] of Object.entries(fields)) {
    if (!(key in row)) continue
    if (field.type === 'checkbox' || field.type === 'switch') {
      values[key] = Boolean(row[key])
    } else {
      values[key] = toInputValue(row[key], field.type)
    }
  }
  return values
}

// ── View (read-only detail) ──────────────────────────────────────────────────

/** Formats a DB value for the read-only view screen */
const displayValue = (value: unknown, field: CmsField): CellValue => {
  const col = listConfig(field)
  if (col.decorate) return col.decorate(value, {})
  if (col.format) return formatters[col.format](value)
  if (field.type === 'switch' || field.type === 'checkbox') return value ? 'Yes' : 'No'
  if (value instanceof Date) return formatters[field.type === 'date' ? 'date' : 'datetime'](value)
  return text(value)
}

export type ViewItem = { key: string; label: string; value: CellValue }

/** Builds the label/value pairs for the view screen from a row */
export const viewItemsFor = (row: Record<string, unknown>, fields: CmsFieldMap): ViewItem[] =>
  Object.entries(fields)
    .filter(([, f]) => f.view !== false)
    .map(([key, f]) => ({ key, label: f.label ?? key, value: displayValue(row[key], f) }))

/** DB columns to SELECT: id plus every non-virtual field */
export const selectColumns = (fields: CmsFieldMap, idColumn: string): string[] => [
  ...new Set([idColumn, ...Object.keys(fields).filter((k) => !fields[k].virtual)]),
]

export const searchableColumns = (fields: CmsFieldMap): string[] =>
  Object.entries(fields).filter(([, f]) => f.search).map(([k]) => k)

export const sortableColumns = (fields: CmsFieldMap): string[] =>
  Object.entries(fields).filter(([, f]) => f.sort).map(([k]) => k)
