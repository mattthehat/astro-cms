import type { CmsAdapter, CmsId, CmsRow, FilterState, ListQuery } from '../types'

/** Tables of rows keyed by table name, e.g. `{ gigs: [{ id: 1, ... }] }` */
export type MemorySeed = Record<string, CmsRow[]>

const asTime = (v: unknown): number | null => {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string' || typeof v === 'number') {
    const t = new Date(v).getTime()
    return Number.isNaN(t) ? null : t
  }
  return null
}

const matchesFilter = (row: CmsRow, f: FilterState): boolean => {
  const value = row[f.column]
  switch (f.type) {
    case 'dateRange': {
      const t = asTime(value)
      if (t === null) return false
      if (f.from && t < new Date(`${f.from}T00:00:00`).getTime()) return false
      if (f.to && t > new Date(`${f.to}T23:59:59.999`).getTime()) return false
      return true
    }
    case 'present':
      return value !== null && value !== undefined
    case 'bool':
      return Boolean(value)
    case 'select':
      return String(value ?? '') === f.value
    case 'nonempty': {
      const set = value !== null && value !== undefined && value !== ''
      return f.state === 'set' ? set : !set
    }
  }
}

// Mixed/unknown types sort by their string form; numbers, dates and
// booleans compare naturally. Nulls always sort last regardless of direction.
const compare = (a: unknown, b: unknown): number => {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const ta = asTime(a)
  const tb = asTime(b)
  if ((a instanceof Date || b instanceof Date) && ta !== null && tb !== null) return ta - tb
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * In-memory CmsAdapter over plain arrays — no database needed. Powers the
 * playground and tests. Rows live for the adapter's lifetime, so state resets
 * whenever the process (or dev server module graph) restarts.
 */
export const memoryAdapter = (seed: MemorySeed = {}): CmsAdapter => {
  // Copy the seed so callers can't mutate our state (and vice versa)
  const tables = new Map<string, CmsRow[]>(
    Object.entries(seed).map(([name, rows]) => [name, rows.map((r) => ({ ...r }))])
  )
  const rowsFor = (table: string): CmsRow[] => {
    if (!tables.has(table)) tables.set(table, [])
    return tables.get(table)!
  }
  const nextId = (rows: CmsRow[], idColumn: string): number =>
    rows.reduce((max, r) => Math.max(max, Number(r[idColumn]) || 0), 0) + 1
  const findIndex = (rows: CmsRow[], idColumn: string, id: CmsId): number =>
    rows.findIndex((r) => String(r[idColumn]) === String(id))

  return {
    async findMany(q: ListQuery) {
      let rows = rowsFor(q.table).filter((row) => q.filters.every((f) => matchesFilter(row, f)))

      if (q.search) {
        const term = q.search.term.toLowerCase()
        const columns = q.search.columns
        rows = rows.filter((row) =>
          columns.some((c) => String(row[c] ?? '').toLowerCase().includes(term))
        )
      }

      if (q.sort) {
        const { column, dir } = q.sort
        const sign = dir === 'desc' ? -1 : 1
        rows = [...rows].sort((a, b) => sign * compare(a[column], b[column]))
      }

      const total = rows.length
      const page = rows
        .slice(q.offset, q.offset + q.limit)
        .map((row) => Object.fromEntries(q.columns.map((c) => [c, row[c]])))
      return { rows: page, total }
    },

    async findOne(table, idColumn, id, columns) {
      const rows = rowsFor(table)
      const i = findIndex(rows, idColumn, id)
      if (i === -1) return null
      return Object.fromEntries(columns.map((c) => [c, rows[i][c]]))
    },

    async create(table, data) {
      const rows = rowsFor(table)
      // The id column isn't in the insert data, so assume the usual 'id'
      const id = nextId(rows, 'id')
      rows.push({ id, ...data })
      return id
    },

    async update(table, idColumn, id, data) {
      const rows = rowsFor(table)
      const i = findIndex(rows, idColumn, id)
      if (i === -1) throw new Error(`memoryAdapter: no ${table} row with ${idColumn} = ${id}`)
      rows[i] = { ...rows[i], ...data }
    },

    async remove(table, idColumn, id) {
      const rows = rowsFor(table)
      const i = findIndex(rows, idColumn, id)
      if (i !== -1) rows.splice(i, 1)
    },

    mapError(err) {
      console.error('memoryAdapter error:', err)
      return { message: 'Something went wrong saving your changes. Please try again.' }
    },
  }
}
