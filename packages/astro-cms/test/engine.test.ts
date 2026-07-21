import { describe, expect, it } from 'vitest'
import type { AstroCookies } from 'astro'
import { defineResource, runCmsResource, pluralise, resourcePlural } from '../src/cms-resource'
import type { CmsResult, CmsState, ResourceConfig } from '../src/cms-resource'
import { memoryAdapter } from '../src/adapters/memory'
import type { CmsAdapter } from '../src/types'

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

type Resource = ReturnType<typeof resource>

const run = (
  config: Resource,
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
  return runCmsResource(config, { request, url, cookies, adapter })
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
    let state = listState(await run(resource(), '/admin/things?sort=likes&dir=desc', { adapter }))
    expect(state.listing.rows.map((r) => r.likes)).toEqual([9, 7, 5])
    expect(state.sort).toEqual({ column: 'likes', dir: 'desc' })

    // `city` is not marked sortable — falls back to the default sort
    state = listState(await run(resource(), '/admin/things?sort=city&dir=desc', { adapter }))
    expect(state.sort.column).toBe('id')
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
