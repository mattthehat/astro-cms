import { describe, expect, it } from 'vitest'
import type { AstroCookies } from 'astro'
import { defineResource, runCmsResource, pluralise, resourcePlural } from '../src/cms-resource'
import type { CmsResult, CmsState, ResourceConfig } from '../src/cms-resource'
import { memoryAdapter } from '../src/adapters/memory'
import type { CmsAdapter, CmsId, ListQuery } from '../src/types'

// Minimal AstroCookies stand-in — just enough for the flash helpers
const fakeCookies = () => {
  const store = new Map<string, string>()
  return {
    get: (name: string) => (store.has(name) ? { value: store.get(name)! } : undefined),
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name),
    store,
  } as unknown as AstroCookies & { store: Map<string, string> }
}

const seed = () => [
  { id: 1, name: 'Alpha', city: 'London', likes: 5, live: 1, notes: 'first', created: '2026-01-10 09:00:00' },
  { id: 2, name: 'Bravo', city: 'Glasgow', likes: 9, live: 0, notes: null, created: '2026-02-10 09:00:00' },
  { id: 3, name: 'Charlie', city: 'London', likes: 1, live: 1, notes: '', created: '2026-03-10 09:00:00' },
  { id: 4, name: 'Delta', city: 'Leeds', likes: 7, live: 0, notes: 'later', created: '2026-04-10 09:00:00' },
]

const resource = () =>
  defineResource({
    table: 'things',
    idColumn: 'id',
    basePath: '/admin/things',
    singular: 'thing',
    perPage: 3,
    defaultSort: { column: 'id', dir: 'asc' },
    fields: {
      name: { label: 'Name', list: true, search: true, sort: true, rules: { required: true } },
      city: { label: 'City', list: true },
      likes: { label: 'Likes', type: 'number', list: true, sort: true },
      live: { label: 'Live', type: 'switch', list: { format: 'bool' } },
      notes: { label: 'Notes' },
      created: { label: 'Created', add: false, edit: false },
    },
    filters: [
      { type: 'select', key: 'city', label: 'City', column: 'city', options: [{ value: 'London', label: 'London' }] },
      { type: 'bool', key: 'live', label: 'Live', column: 'live' },
      { type: 'nonempty', key: 'notes', label: 'Notes', column: 'notes' },
      { type: 'dateRange', key: 'created', label: 'Created', column: 'created' },
    ],
  })

// `defineResource` infers each field's literal shape, which is the point in real
// code but stops a test tweaking one flag in place. Variants widen first.
type Resource = ReturnType<typeof resource>
const variant = (): ResourceConfig => resource() as unknown as ResourceConfig

const run = (
  config: Resource | ResourceConfig,
  path: string,
  { adapter, method = 'GET', body, cookies = fakeCookies() }: {
    adapter: CmsAdapter
    method?: string
    body?: Record<string, string>
    cookies?: AstroCookies
  }
): Promise<CmsResult> => {
  const url = new URL(`http://localhost${path}`)
  const request = new Request(url, {
    method,
    ...(body ? { body: new URLSearchParams(body) } : {}),
  })
  return runCmsResource(config as ResourceConfig, { request, url, cookies, adapter })
}

const listState = (result: CmsResult) => {
  const state = (result as { state: CmsState }).state
  if (state.mode !== 'list') throw new Error(`expected list state, got ${state.mode}`)
  return state
}

describe('list mode', () => {
  const adapter = memoryAdapter({ things: seed() })

  it('lists with default sort, pagination metadata and columns', async () => {
    const state = listState(await run(resource(), '/admin/things', { adapter }))
    expect(state.listing.rows.map((r) => r.id)).toEqual([1, 2, 3])
    expect(state.listing).toMatchObject({ page: 1, total: 4, totalPages: 2, perPage: 3 })
    expect(state.columns.map((c) => c.key)).toEqual(['name', 'city', 'likes', 'live'])
    expect(state.canCreate).toBe(true)
  })

  it('paginates', async () => {
    const state = listState(await run(resource(), '/admin/things?page=2', { adapter }))
    expect(state.listing.rows.map((r) => r.id)).toEqual([4])
  })

  it('searches the searchable columns', async () => {
    const state = listState(await run(resource(), '/admin/things?q=rav', { adapter }))
    expect(state.listing.rows.map((r) => r.name)).toEqual(['Bravo'])
  })

  it('applies select, bool, nonempty and dateRange filters', async () => {
    let state = listState(await run(resource(), '/admin/things?city=London', { adapter }))
    expect(state.listing.rows.map((r) => r.id)).toEqual([1, 3])

    state = listState(await run(resource(), '/admin/things?live=1', { adapter }))
    expect(state.listing.rows.map((r) => r.id)).toEqual([1, 3])

    state = listState(await run(resource(), '/admin/things?notes=set', { adapter }))
    expect(state.listing.rows.map((r) => r.id)).toEqual([1, 4])
    state = listState(await run(resource(), '/admin/things?notes=unset', { adapter }))
    expect(state.listing.rows.map((r) => r.id)).toEqual([2, 3])

    state = listState(await run(resource(), '/admin/things?created_from=2026-02-01&created_to=2026-03-31', { adapter }))
    expect(state.listing.rows.map((r) => r.id)).toEqual([2, 3])
  })

  it('sorts by a sortable column and ignores non-sortable ones', async () => {
    // The original ?sort=col&dir= form still works
    let state = listState(await run(resource(), '/admin/things?sort=likes&dir=desc', { adapter }))
    expect(state.listing.rows.map((r) => r.likes)).toEqual([9, 7, 5])
    expect(state.order).toEqual([{ column: 'likes', dir: 'desc' }])

    // `city` is not marked sortable — falls back to the default sort
    state = listState(await run(resource(), '/admin/things?sort=city&dir=desc', { adapter }))
    expect(state.order[0].column).toBe('id')
  })
})

describe('multi-column sort', () => {
  const multi = () => {
    const config = variant()
    config.fields.city.sort = true
    config.perPage = 10
    return config
  }

  it('orders by every term in ?sort=, most significant first', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const state = listState(await run(multi(), '/admin/things?sort=city:asc,likes:desc', { adapter }))

    expect(state.order).toEqual([
      { column: 'city', dir: 'asc' },
      { column: 'likes', dir: 'desc' },
    ])
    // Glasgow(9), Leeds(7), then London sorted by likes descending: 5 then 1
    expect(state.listing.rows.map((r) => r.city)).toEqual(['Glasgow', 'Leeds', 'London', 'London'])
    expect(state.listing.rows.map((r) => r.likes)).toEqual([9, 7, 5, 1])
  })

  it('drops non-sortable and duplicate terms', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const state = listState(await run(multi(), '/admin/things?sort=notes:asc,city:asc,city:desc', { adapter }))
    // `notes` is not sortable and the repeated `city` is ignored
    expect(state.order).toEqual([{ column: 'city', dir: 'asc' }])
  })

  it('passes the primary term as `sort` so single-sort adapters still work', async () => {
    let seen: ListQuery | undefined
    const adapter = memoryAdapter({ things: seed() })
    const spy: CmsAdapter = { ...adapter, findMany: (q) => { seen = q; return adapter.findMany(q) } }

    await run(multi(), '/admin/things?sort=city:desc,likes:asc', { adapter: spy })
    expect(seen!.sort).toEqual({ column: 'city', dir: 'desc' })
    expect(seen!.order).toHaveLength(2)
  })
})

describe('per-page', () => {
  it('accepts only a configured page size', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = variant()
    config.perPageOptions = [2, 4]

    const chosen = listState(await run(config, '/admin/things?perPage=2', { adapter }))
    expect(chosen.listing.perPage).toBe(2)
    expect(chosen.listing.rows).toHaveLength(2)

    // Not in the list — falls back to the configured default rather than obeying
    const bogus = listState(await run(config, '/admin/things?perPage=1000', { adapter }))
    expect(bogus.listing.perPage).toBe(3)
  })

  it('offers no picker unless perPageOptions is set', async () => {
    const adapter = memoryAdapter({ things: seed() })
    expect(listState(await run(resource(), '/admin/things', { adapter })).perPageOptions).toEqual([])
  })
})

describe('column visibility', () => {
  it('hides `hidden` columns by default and honours ?cols=', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = variant()
    config.fields.city.hidden = true

    const byDefault = listState(await run(config, '/admin/things', { adapter }))
    expect(byDefault.columns.map((c) => c.key)).not.toContain('city')
    // The picker still lists it, so it can be turned back on
    expect(byDefault.allColumns.map((c) => c.key)).toContain('city')

    const chosen = listState(await run(config, '/admin/things?cols=city,likes', { adapter }))
    expect(chosen.columns.map((c) => c.key)).toEqual(['city', 'likes'])

    // The picker is a checkbox group, so it submits one `cols` param per column
    // rather than a comma-joined one — both forms have to work
    const repeated = listState(await run(config, '/admin/things?cols=city&cols=likes', { adapter }))
    expect(repeated.columns.map((c) => c.key)).toEqual(['city', 'likes'])

    // Columns come out in config order, not the order they appear in the URL
    const reversed = listState(await run(config, '/admin/things?cols=likes&cols=city', { adapter }))
    expect(reversed.columns.map((c) => c.key)).toEqual(['city', 'likes'])

    // An entirely bogus selection would leave a table with no columns
    const bogus = listState(await run(config, '/admin/things?cols=nope', { adapter }))
    expect(bogus.columns.map((c) => c.key)).toEqual(byDefault.columns.map((c) => c.key))
  })
})

describe('computed columns', () => {
  const computed = () => {
    const config = variant()
    config.fields.summary = {
      label: 'Summary',
      list: true,
      compute: (row) => `${row.name} (${row.city})`,
    }
    return config
  }

  it('derives values after the read and keeps them out of the SELECT', async () => {
    let seen: ListQuery | undefined
    const adapter = memoryAdapter({ things: seed() })
    const spy: CmsAdapter = { ...adapter, findMany: (q) => { seen = q; return adapter.findMany(q) } }

    const state = listState(await run(computed(), '/admin/things', { adapter: spy }))
    expect(seen!.columns).not.toContain('summary')
    expect(state.listing.rows[0].summary).toBe('Alpha (London)')
  })

  it('reaches the view screen too', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const result = await run(computed(), '/admin/things?action=view&id=1', { adapter })
    const state = (result as { state: CmsState }).state
    if (state.mode !== 'view') throw new Error('expected view state')
    expect(state.items.find((i) => i.key === 'summary')?.value).toBe('Alpha (London)')
  })
})

describe('CSV export', () => {
  const exportable = () => {
    const config = variant()
    config.csv = true
    config.fields.likes.export = false
    return config
  }

  it('exports every matching row, not just the current page', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const result = await run(exportable(), '/admin/things?action=export', { adapter })
    if (!('response' in result)) throw new Error('expected a response')

    expect(result.response.headers.get('content-type')).toContain('text/csv')
    expect(result.response.headers.get('content-disposition')).toContain('things.csv')

    const body = await result.response.text()
    const lines = body.split('\r\n')
    // Header plus all four rows, though perPage is 3
    expect(lines).toHaveLength(5)
    // `likes` opted out of the export
    expect(lines[0]).toBe('Name,City,Live')
    expect(lines[1]).toBe('Alpha,London,1')
  })

  it('respects the active search and quotes awkward values', async () => {
    const adapter = memoryAdapter({ things: [{ id: 1, name: 'Alpha, "the first"', city: 'London', likes: 1, live: 1, notes: '', created: null }] })
    const result = await run(exportable(), '/admin/things?action=export&q=Alpha', { adapter })
    if (!('response' in result)) throw new Error('expected a response')

    const lines = (await result.response.text()).split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('"Alpha, ""the first""",London,1')
  })

  it('is inert unless enabled', async () => {
    const adapter = memoryAdapter({ things: seed() })
    // Falls through to the normal list rather than exporting
    const result = await run(resource(), '/admin/things?action=export', { adapter })
    expect('state' in result).toBe(true)
  })
})

describe('bulk actions', () => {
  const bulkRun = (config: Resource | ResourceConfig, path: string, adapter: CmsAdapter, body: Record<string, string | string[]>) => {
    const url = new URL(`http://localhost${path}`)
    const form = new FormData()
    for (const [key, value] of Object.entries(body)) {
      for (const v of Array.isArray(value) ? value : [value]) form.append(key, v)
    }
    return runCmsResource(config as ResourceConfig, {
      request: new Request(url, { method: 'POST', body: form }),
      url,
      cookies: fakeCookies(),
      adapter,
    })
  }

  it('offers Delete by default and removes the selection', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = resource()
    expect(listState(await run(config, '/admin/things', { adapter })).bulkActions.map((a) => a.key)).toEqual(['delete'])

    await bulkRun(config, '/admin/things?action=bulk', adapter, { bulk: 'delete', ids: ['1', '3'] })
    const after = listState(await run(config, '/admin/things', { adapter }))
    expect(after.listing.rows.map((r) => r.id)).toEqual([2, 4])
  })

  it('falls back to one remove per id when the adapter has no removeMany', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const { removeMany: _removeMany, ...withoutBulk } = adapter
    const removed: unknown[] = []
    const single: CmsAdapter = { ...withoutBulk, remove: (t, c, id) => { removed.push(id); return adapter.remove(t, c, id) } }

    await bulkRun(resource(), '/admin/things?action=bulk', single, { bulk: 'delete', ids: ['1', '2'] })
    expect(removed).toEqual([1, 2])
  })

  it('routes a custom bulk handler and ignores unknown keys', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = variant()
    let got: CmsId[] = []
    config.bulkActions = () => [{ key: 'publish', label: 'Publish' }]
    config.hooks = { bulk: { publish: (ids) => { got = ids; return '/done' } } }

    const result = await bulkRun(config, '/admin/things?action=bulk', adapter, { bulk: 'publish', ids: ['2', '4'] })
    expect(result).toEqual({ redirect: '/done' })
    expect(got).toEqual([2, 4])

    // 'delete' is no longer on offer, so it must not delete anything
    await bulkRun(config, '/admin/things?action=bulk', adapter, { bulk: 'delete', ids: ['1'] })
    expect(await adapter.findOne('things', 'id', 1, ['id'])).not.toBeNull()
  })

  it('has no selection UI when the user cannot delete', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = resource()
    config.canDelete = () => false
    expect(listState(await run(config, '/admin/things', { adapter })).bulkActions).toEqual([])
  })
})

describe('soft delete', () => {
  const soft = () => {
    const config = variant()
    config.softDelete = { column: 'deleted_at' }
    return config
  }

  it('stamps the column instead of deleting, then hides and restores the row', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = soft()

    await run(config, '/admin/things?action=delete&id=1', { adapter, method: 'POST' })

    // Still there, just stamped
    const row = await adapter.findOne('things', 'id', 1, ['id', 'deleted_at'])
    expect(row?.deleted_at).toBeInstanceOf(Date)

    // Gone from the live list, present in the trash
    expect(listState(await run(config, '/admin/things', { adapter })).listing.rows.map((r) => r.id)).toEqual([2, 3, 4])
    const trash = listState(await run(config, '/admin/things?trash=1', { adapter }))
    expect(trash.listing.rows.map((r) => r.id)).toEqual([1])
    expect(trash.trash).toBe(true)
    expect(trash.actions.map((a) => a.label)).toContain('Restore')

    await run(config, '/admin/things?action=restore&id=1', { adapter, method: 'POST' })
    // Back in the live list (whose first page holds perPage=3 of the 4 rows)
    const restored = listState(await run(config, '/admin/things', { adapter }))
    expect(restored.listing.total).toBe(4)
    expect(restored.listing.rows.map((r) => r.id)).toEqual([1, 2, 3])
    expect(listState(await run(config, '/admin/things?trash=1', { adapter })).listing.rows).toEqual([])
  })

  it('really deletes from the trash view', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = soft()

    await run(config, '/admin/things?action=delete&id=1', { adapter, method: 'POST' })
    await run(config, '/admin/things?action=delete&trash=1&id=1', { adapter, method: 'POST' })
    expect(await adapter.findOne('things', 'id', 1, ['id'])).toBeNull()
  })

  it('treats a soft-deleted row as missing when viewed or edited directly', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = soft()
    await run(config, '/admin/things?action=delete&id=1', { adapter, method: 'POST' })

    expect(await run(config, '/admin/things?action=view&id=1', { adapter })).toEqual({ redirect: '/admin/things' })
    expect(await run(config, '/admin/things?action=edit&id=1', { adapter })).toEqual({ redirect: '/admin/things' })
  })
})

describe('timestamps', () => {
  it('stamps created and updated on insert, and only updated on edit', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = variant()
    config.timestamps = { created: 'created_at', updated: 'updated_at' }

    await run(config, '/admin/things?action=new', { adapter, method: 'POST', body: { name: 'Echo', city: 'Bath', likes: '2', notes: '' } })
    const created = await adapter.findOne('things', 'id', 5, ['created_at', 'updated_at'])
    expect(created?.created_at).toBeInstanceOf(Date)
    expect(created?.updated_at).toBeInstanceOf(Date)

    await run(config, '/admin/things?action=edit&id=1', { adapter, method: 'POST', body: { name: 'Alpha II', city: 'London', likes: '5', notes: '' } })
    const edited = await adapter.findOne('things', 'id', 1, ['created_at', 'updated_at'])
    expect(edited?.created_at).toBeUndefined()
    expect(edited?.updated_at).toBeInstanceOf(Date)
  })
})

describe('optimistic concurrency', () => {
  const versioned = () => {
    const config = variant()
    config.concurrency = { column: 'version' }
    return config
  }
  const rows = () => seed().map((r) => ({ ...r, version: 1 }))

  it('puts the current version in the form action', async () => {
    const adapter = memoryAdapter({ things: rows() })
    const result = await run(versioned(), '/admin/things?action=edit&id=1', { adapter })
    const state = (result as { state: CmsState }).state
    if (state.mode !== 'form') throw new Error('expected form state')
    expect(state.form.action).toBe('/admin/things?action=edit&id=1&_v=1')
  })

  it('saves when the token matches', async () => {
    const adapter = memoryAdapter({ things: rows() })
    const result = await run(versioned(), '/admin/things?action=edit&id=1&_v=1', {
      adapter, method: 'POST', body: { name: 'Alpha II', city: 'London', likes: '5', notes: '' },
    })
    expect(result).toEqual({ redirect: '/admin/things' })
    expect((await adapter.findOne('things', 'id', 1, ['name']))?.name).toBe('Alpha II')
  })

  it('refuses the write when the row moved on, and does not clobber it', async () => {
    const adapter = memoryAdapter({ things: rows() })
    // Someone else saves while our form is open
    await adapter.update('things', 'id', 1, { name: 'Alpha (theirs)', version: 2 })

    const result = await run(versioned(), '/admin/things?action=edit&id=1&_v=1', {
      adapter, method: 'POST', body: { name: 'Alpha (mine)', city: 'London', likes: '5', notes: '' },
    })
    const state = (result as { state: CmsState }).state
    if (state.mode !== 'form') throw new Error('expected the form back')
    expect(state.serverError).toMatch(/changed by someone else/)
    // Their write survived; ours was not applied
    expect((await adapter.findOne('things', 'id', 1, ['name']))?.name).toBe('Alpha (theirs)')
    // The re-rendered form carries the new token, so a resubmit can go through
    expect(state.form.action).toContain('_v=2')
  })
})

describe('create', () => {
  it('renders the create form on GET', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const result = await run(resource(), '/admin/things?action=new', { adapter })
    const state = (result as { state: CmsState }).state
    expect(state.mode).toBe('form')
    if (state.mode !== 'form') return
    expect(state.formMode).toBe('create')
    expect(Object.keys(state.form.fields)).not.toContain('created') // add: false
  })

  it('persists a valid POST, runs before/afterInsert, redirects with flash', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const calls: string[] = []
    const config = resource()
    config.hooks = {
      beforeInsert: (row) => {
        calls.push('before')
        return { ...row, city: 'Hooked' }
      },
      afterInsert: (id) => {
        calls.push(`after:${id}`)
      },
    }
    const cookies = fakeCookies()
    const result = await run(config, '/admin/things?action=new', {
      adapter,
      method: 'POST',
      body: { name: 'Echo', city: 'York', likes: '2', notes: '' },
      cookies,
    })
    expect(result).toEqual({ redirect: '/admin/things' })
    expect(calls).toEqual(['before', 'after:5'])
    const row = await adapter.findOne('things', 'id', 5, ['id', 'name', 'city', 'likes', 'live', 'notes'])
    expect(row).toMatchObject({ name: 'Echo', city: 'Hooked', likes: 2, live: 0, notes: null })
    expect(cookies.store.get('ac_flash')).toContain('saved')
  })

  it('returns the form with errors on an invalid POST', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const result = await run(resource(), '/admin/things?action=new', {
      adapter,
      method: 'POST',
      body: { name: '', city: 'York' },
    })
    const state = (result as { state: CmsState }).state
    expect(state.mode).toBe('form')
    if (state.mode !== 'form') return
    expect(state.errors.name).toBeDefined()
    expect(state.values.city).toBe('York')
  })

  it('afterInsert can override the redirect', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = resource()
    config.hooks = { afterInsert: (id) => `/admin/things?action=view&id=${id}` }
    const result = await run(config, '/admin/things?action=new', {
      adapter,
      method: 'POST',
      body: { name: 'Echo' },
    })
    expect(result).toEqual({ redirect: '/admin/things?action=view&id=5' })
  })
})

describe('edit', () => {
  it('prefills the edit form from the adapter', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const result = await run(resource(), '/admin/things?action=edit&id=2', { adapter })
    const state = (result as { state: CmsState }).state
    expect(state.mode).toBe('form')
    if (state.mode !== 'form') return
    expect(state.formMode).toBe('edit')
    expect(state.values).toMatchObject({ name: 'Bravo', city: 'Glasgow', likes: '9', live: false })
  })

  it('updates on POST and redirects', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const result = await run(resource(), '/admin/things?action=edit&id=2', {
      adapter,
      method: 'POST',
      body: { name: 'Bravo II', city: 'Glasgow', likes: '10', live: 'on', notes: 'edited' },
    })
    expect(result).toEqual({ redirect: '/admin/things' })
    const row = await adapter.findOne('things', 'id', 2, ['name', 'likes', 'live', 'notes'])
    expect(row).toEqual({ name: 'Bravo II', likes: 10, live: 1, notes: 'edited' })
  })

  it('redirects with a warning when the row is gone', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const cookies = fakeCookies()
    const result = await run(resource(), '/admin/things?action=edit&id=99', { adapter, cookies })
    expect(result).toEqual({ redirect: '/admin/things' })
    expect(cookies.store.get('ac_flash')).toContain('no longer exists')
  })
})

describe('view', () => {
  it('returns view items for an existing row', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const result = await run(resource(), '/admin/things?action=view&id=1', { adapter })
    const state = (result as { state: CmsState }).state
    expect(state.mode).toBe('view')
    if (state.mode !== 'view') return
    expect(state.id).toBe(1)
    // `live` has a bool list format, so the view reuses the tick icon
    expect(state.items.find((i) => i.key === 'live')!.value).toMatchObject({ icon: 'lucide:check', label: 'Yes' })
    // Edit is allowed by default, so the view screen shows its Edit CTA
    expect(state.canEdit).toBe(true)
  })
})

describe('delete', () => {
  it('deletes on POST and redirects with flash', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const cookies = fakeCookies()
    const result = await run(resource(), '/admin/things?action=delete&id=1', { adapter, method: 'POST', cookies })
    expect(result).toEqual({ redirect: '/admin/things' })
    expect(await adapter.findOne('things', 'id', 1, ['id'])).toBeNull()
    expect(cookies.store.get('ac_flash')).toContain('deleted')
  })

  it('beforeDelete can block by returning a redirect', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = resource()
    config.hooks = { beforeDelete: () => '/admin/things?blocked=1' }
    const result = await run(config, '/admin/things?action=delete&id=1', { adapter, method: 'POST' })
    expect(result).toEqual({ redirect: '/admin/things?blocked=1' })
    expect(await adapter.findOne('things', 'id', 1, ['id'])).not.toBeNull()
  })
})

describe('canCreate gate', () => {
  it('blocks the create form and hides the CTA', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = resource()
    config.canCreate = () => false
    const cookies = fakeCookies()

    const blocked = await run(config, '/admin/things?action=new', { adapter, cookies })
    expect(blocked).toEqual({ redirect: '/admin/things' })
    expect(cookies.store.get('ac_flash')).toContain('permission')

    const state = listState(await run(config, '/admin/things', { adapter }))
    expect(state.canCreate).toBe(false)
  })
})

describe('canEdit gate', () => {
  it('blocks the edit form, hides the view CTA and drops the Edit row action', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = resource()
    config.canEdit = () => false
    const cookies = fakeCookies()

    // Edit form is blocked server-side (GET render and POST submit)
    const blocked = await run(config, '/admin/things?action=edit&id=2', { adapter, cookies })
    expect(blocked).toEqual({ redirect: '/admin/things' })
    expect(cookies.store.get('ac_flash')).toContain('permission')

    // View screen reports canEdit false so the component omits the Edit CTA
    const viewResult = await run(config, '/admin/things?action=view&id=1', { adapter })
    const viewState = (viewResult as { state: CmsState }).state
    expect(viewState.mode).toBe('view')
    if (viewState.mode !== 'view') return
    expect(viewState.canEdit).toBe(false)

    // Default row actions drop Edit, keeping Delete
    const labels = listState(await run(config, '/admin/things', { adapter })).actions.map((a) => a.label)
    expect(labels).not.toContain('Edit')
    expect(labels).toContain('Delete')
  })
})

describe('canDelete gate', () => {
  it('blocks the delete POST and drops the Delete row action', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = resource()
    config.canDelete = () => false
    const cookies = fakeCookies()

    const blocked = await run(config, '/admin/things?action=delete&id=1', { adapter, method: 'POST', cookies })
    expect(blocked).toEqual({ redirect: '/admin/things' })
    expect(cookies.store.get('ac_flash')).toContain('permission')

    // The row survived — the gate ran before the adapter was touched
    expect(await adapter.findOne('things', 'id', 1, ['id'])).not.toBeNull()

    // Default row actions drop Delete, keeping Edit
    const labels = listState(await run(config, '/admin/things', { adapter })).actions.map((a) => a.label)
    expect(labels).not.toContain('Delete')
    expect(labels).toContain('Edit')
  })
})

describe('string ids', () => {
  const slugResource = () => {
    const config = resource() as unknown as ResourceConfig
    config.table = 'docs'
    config.idColumn = 'slug'
    config.defaultSort = { column: 'slug', dir: 'asc' }
    return config as Resource
  }
  const slugSeed = () => [
    { slug: 'alpha-doc', name: 'Alpha', city: 'London', likes: 1, live: 1, notes: 'x', created: '2026-01-10 09:00:00' },
    { slug: 'bravo-doc', name: 'Bravo', city: 'Leeds', likes: 2, live: 0, notes: 'y', created: '2026-02-10 09:00:00' },
  ]

  it('views, edits and deletes a row keyed by a non-numeric id', async () => {
    const adapter = memoryAdapter({ docs: slugSeed() })
    const config = slugResource()

    // View resolves the row rather than falling through to the list
    const viewState = (await run(config, '/admin/things?action=view&id=alpha-doc', { adapter }) as { state: CmsState }).state
    expect(viewState.mode).toBe('view')
    if (viewState.mode !== 'view') return
    expect(viewState.id).toBe('alpha-doc')

    // Edit prefills from the DB
    const formState = (await run(config, '/admin/things?action=edit&id=bravo-doc', { adapter }) as { state: CmsState }).state
    expect(formState.mode).toBe('form')
    if (formState.mode !== 'form') return
    expect(formState.values.name).toBe('Bravo')

    // Delete removes the right row
    await run(config, '/admin/things?action=delete&id=alpha-doc', { adapter, method: 'POST' })
    expect(await adapter.findOne('docs', 'slug', 'alpha-doc', ['slug'])).toBeNull()
    expect(await adapter.findOne('docs', 'slug', 'bravo-doc', ['slug'])).not.toBeNull()
  })

  it('escapes ids in the default row action URLs', async () => {
    const adapter = memoryAdapter({ docs: [{ ...slugSeed()[0], slug: 'a/b c' }] })
    const state = listState(await run(slugResource(), '/admin/things', { adapter }))
    const edit = state.actions.find((a) => a.label === 'Edit')!
    expect('href' in edit && edit.href({ slug: 'a/b c' })).toBe('/admin/things?action=edit&id=a%2Fb%20c')
  })
})

describe('custom actions and row actions', () => {
  it('routes a custom POST action and returns its redirect', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = resource()
    config.hooks = {
      actions: { publish: async (id) => `/admin/things?published=${id}` },
    }
    const result = await run(config, '/admin/things?action=publish&id=3', { adapter, method: 'POST' })
    expect(result).toEqual({ redirect: '/admin/things?published=3' })
  })

  it('uses custom rowActions when provided, defaults otherwise', async () => {
    const adapter = memoryAdapter({ things: seed() })
    const config = resource()
    let state = listState(await run(config, '/admin/things', { adapter }))
    expect(state.actions.map((a) => a.label)).toEqual(['Edit', 'Delete'])

    config.rowActions = () => [{ label: 'Publish', href: (row) => `/publish/${row.id}` }]
    state = listState(await run(config, '/admin/things', { adapter }))
    expect(state.actions.map((a) => a.label)).toEqual(['Publish'])
  })
})

describe('pluralisation', () => {
  it('derives plurals and honours overrides', () => {
    expect(pluralise('gig')).toBe('gigs')
    expect(pluralise('city')).toBe('cities')
    expect(pluralise('match')).toBe('matches')
    expect(resourcePlural({ singular: 'person', plural: 'people' } as ResourceConfig)).toBe('people')
  })
})
