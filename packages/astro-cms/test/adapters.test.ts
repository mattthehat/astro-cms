import { describe, expect, it } from 'vitest'
import { memoryAdapter } from '../src/adapters/memory'
import { atlasAdapter, buildListWhere, mapMysqlError } from '../src/adapters/atlas-mysql'
import type { CmsAdapter, ListQuery } from '../src/types'

// ── Shared adapter contract ───────────────────────────────────────────────────
// Every adapter must pass this suite. The atlas adapter needs a live MySQL, so
// only the memory adapter runs it here; its query translation is covered below.

const contract = (name: string, makeAdapter: () => Promise<CmsAdapter> | CmsAdapter) => {
  const COLUMNS = ['id', 'name', 'score', 'active', 'notes', 'created']
  const seedRows = () => [
    { id: 1, name: 'Alpha', score: 5, active: 1, notes: 'aa', created: '2026-01-01 10:00:00' },
    { id: 2, name: 'beta', score: 9, active: 0, notes: null, created: '2026-02-01 10:00:00' },
    { id: 3, name: 'Gamma', score: 2, active: 1, notes: '', created: '2026-03-01 10:00:00' },
  ]

  const base: ListQuery = {
    table: 'items',
    idColumn: 'id',
    columns: COLUMNS,
    filters: [],
    limit: 10,
    offset: 0,
  }

  describe(`${name}: adapter contract`, () => {
    it('CRUD round-trip: create, findOne, update, remove', async () => {
      const adapter = await makeAdapter()
      const id = await adapter.create('items', { name: 'Delta', score: 4, active: 1, notes: null, created: '2026-04-01 10:00:00' })
      expect(id).toBeTruthy()

      let row = await adapter.findOne('items', 'id', id, ['id', 'name', 'score'])
      expect(row).toMatchObject({ name: 'Delta', score: 4 })
      expect(Object.keys(row!)).toEqual(['id', 'name', 'score']) // only requested columns

      await adapter.update('items', 'id', id, { score: 8 })
      row = await adapter.findOne('items', 'id', id, ['score'])
      expect(row).toEqual({ score: 8 })

      await adapter.remove('items', 'id', id)
      expect(await adapter.findOne('items', 'id', id, ['id'])).toBeNull()
    })

    it('findMany: search, filters, sort, pagination and total', async () => {
      const adapter = await makeAdapter()

      let res = await adapter.findMany({ ...base, search: { columns: ['name', 'notes'], term: 'ALPH' } })
      expect(res.rows.map((r) => r.id)).toEqual([1])

      res = await adapter.findMany({ ...base, filters: [{ type: 'bool', column: 'active' }] })
      expect(res.rows.map((r) => r.id)).toEqual([1, 3])

      res = await adapter.findMany({ ...base, filters: [{ type: 'nonempty', column: 'notes', state: 'unset' }] })
      expect(res.rows.map((r) => r.id)).toEqual([2, 3])

      res = await adapter.findMany({
        ...base,
        filters: [{ type: 'dateRange', column: 'created', from: '2026-01-15', to: '2026-02-15' }],
      })
      expect(res.rows.map((r) => r.id)).toEqual([2])

      res = await adapter.findMany({ ...base, sort: { column: 'score', dir: 'desc' }, limit: 2, offset: 0 })
      expect(res.rows.map((r) => r.score)).toEqual([9, 5])
      expect(res.total).toBe(3) // total ignores the page window

      res = await adapter.findMany({ ...base, sort: { column: 'score', dir: 'desc' }, limit: 2, offset: 2 })
      expect(res.rows.map((r) => r.score)).toEqual([2])
    })

    it('mapError always yields something renderable', async () => {
      const adapter = await makeAdapter()
      const mapped = adapter.mapError(new Error('boom'), {})
      expect(mapped.message || mapped.errors).toBeTruthy()
    })
  })

  return { seedRows }
}

contract('memory', () => memoryAdapter({
  items: [
    { id: 1, name: 'Alpha', score: 5, active: 1, notes: 'aa', created: '2026-01-01 10:00:00' },
    { id: 2, name: 'beta', score: 9, active: 0, notes: null, created: '2026-02-01 10:00:00' },
    { id: 3, name: 'Gamma', score: 2, active: 1, notes: '', created: '2026-03-01 10:00:00' },
  ],
}))

// ── atlas-mysql query translation (no DB needed) ─────────────────────────────

describe('atlas-mysql buildListWhere', () => {
  const base: ListQuery = { table: 't', idColumn: 'id', columns: ['id'], filters: [], limit: 10, offset: 0 }

  it('builds parameterised search and filter clauses in order', () => {
    const { where, values } = buildListWhere({
      ...base,
      search: { columns: ['name', 'email'], term: 'foo' },
      filters: [
        { type: 'dateRange', column: 'created', from: '2026-01-01', to: '2026-01-31' },
        { type: 'present', column: 'deleted_at' },
        { type: 'bool', column: 'active' },
        { type: 'select', column: 'city', value: 'London' },
        { type: 'nonempty', column: 'notes', state: 'set' },
        { type: 'nonempty', column: 'bio', state: 'unset' },
      ],
    })
    expect(where).toEqual([
      '(name LIKE ? OR email LIKE ?)',
      'created >= ?',
      'created <= ?',
      'deleted_at IS NOT NULL',
      'active = ?',
      'city = ?',
      '(notes IS NOT NULL AND notes <> ?)',
      '(bio IS NULL OR bio = ?)',
    ])
    expect(values).toEqual(['%foo%', '%foo%', '2026-01-01 00:00:00', '2026-01-31 23:59:59', 1, 'London', '', ''])
  })

  it('is empty with no search or filters', () => {
    expect(buildListWhere(base)).toEqual({ where: [], values: [] })
  })
})

describe('atlas-mysql mapError', () => {
  const fields = {
    email: { label: 'Email', rules: { unique: true } },
    name: { label: 'Name' },
  }

  it('maps ER_DUP_ENTRY onto the unique field', () => {
    const err = { code: 'ER_DUP_ENTRY', message: "Duplicate entry 'x' for key 'users.email'" }
    expect(mapMysqlError(err, fields)).toEqual({ errors: { email: ['Email is already in use'] } })
  })

  it('falls back to a form-level message when no unique field matches', () => {
    const err = { code: 'ER_DUP_ENTRY', message: "Duplicate entry 'x' for key 'users.other'" }
    expect(mapMysqlError(err, fields)).toEqual({ message: 'One of these values is already in use.' })
  })

  it('maps ER_DATA_TOO_LONG onto the named column', () => {
    const err = { code: 'ER_DATA_TOO_LONG', message: "Data too long for column 'name' at row 1" }
    expect(mapMysqlError(err, fields)).toEqual({ errors: { name: ['Name is too long'] } })
  })

  it('returns a generic message for anything else', () => {
    expect(mapMysqlError(new Error('nope'), fields).message).toMatch(/went wrong/)
  })
})

// Type-level check: the factory satisfies CmsAdapter without a live ORM
it('atlasAdapter satisfies CmsAdapter', () => {
  const make: (orm: never) => CmsAdapter = atlasAdapter
  expect(typeof make).toBe('function')
})
