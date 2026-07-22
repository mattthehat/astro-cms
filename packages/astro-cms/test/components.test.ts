import { describe, expect, it } from 'vitest'
import { defineResource } from '../src/cms-resource'
import type { ResourceConfig } from '../src/cms-resource'
import { memoryAdapter } from '../src/adapters/memory'
import { follow, listState, load, submit, tick, visit } from './browser'

// These drive the rendered UI rather than hand-written URLs: every request here
// comes from a form or link the components actually emitted. A component that
// emits a shape the engine cannot read fails here even if the engine's own
// suite passes.

const seed = () => [
  { id: 1, name: 'Alpha', city: 'London', likes: 5, live: 1, notes: 'first' },
  { id: 2, name: 'Bravo', city: 'Glasgow', likes: 9, live: 0, notes: null },
  { id: 3, name: 'Charlie', city: 'London', likes: 1, live: 1, notes: '' },
  { id: 4, name: 'Delta', city: 'Leeds', likes: 7, live: 0, notes: 'later' },
]

const resource = (): ResourceConfig =>
  defineResource({
    table: 'things',
    idColumn: 'id',
    basePath: '/admin/things',
    singular: 'thing',
    perPage: 3,
    perPageOptions: [3, 10],
    csv: true,
    defaultSort: { column: 'id', dir: 'asc' },
    fields: {
      name: { label: 'Name', list: true, search: true, sort: true, rules: { required: true } },
      city: { label: 'City', list: true, sort: true },
      likes: { label: 'Likes', type: 'number', list: true, sort: true },
      live: { label: 'Live', type: 'switch', list: { format: 'bool' } },
      notes: { label: 'Notes' },
    },
    filters: [
      { type: 'select', key: 'city', label: 'City', column: 'city', options: [{ value: 'London', label: 'London' }] },
    ],
  }) as unknown as ResourceConfig

const adapter = () => memoryAdapter({ things: seed() })

const columnKeys = (result: Parameters<typeof listState>[0]) => listState(result).columns.map((c) => c.key)

describe('column picker', () => {
  it('applies the columns actually ticked in the rendered picker', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things', db)

    const form = document.querySelector('[data-ac-controls]')!
    const boxes = [...document.querySelectorAll('input[name="cols"]')]
    expect(boxes.length).toBeGreaterThan(2)

    // Untick everything, then choose two — exactly what a user does
    boxes.forEach((box) => tick(box, false))
    tick(boxes.find((b) => b.getAttribute('value') === 'city')!)
    tick(boxes.find((b) => b.getAttribute('value') === 'likes')!)

    const result = await submit(document, form, { adapter: db, config })
    expect(columnKeys(result)).toEqual(['city', 'likes'])
  })

  it('renders the current selection back as ticked boxes', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things?cols=city&cols=likes', db)

    const ticked = [...document.querySelectorAll('input[name="cols"]')]
      .filter((b) => b.hasAttribute('checked'))
      .map((b) => b.getAttribute('value'))
    expect(ticked).toEqual(['city', 'likes'])
  })

  it('round-trips: re-submitting the picker untouched keeps the same columns', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things?cols=city&cols=likes', db)

    const result = await submit(document, document.querySelector('[data-ac-controls]')!, { adapter: db, config })
    expect(columnKeys(result)).toEqual(['city', 'likes'])
  })
})

describe('state survives the controls that do not own it', () => {
  it('keeps the chosen columns when the search form is submitted', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things?cols=city&cols=likes', db)

    const search = document.querySelector('form.ac-toolbar')!
    search.querySelector('input[name="q"]')!.setAttribute('value', 'Alpha')

    const result = await submit(document, search, { adapter: db, config })
    expect(columnKeys(result)).toEqual(['city', 'likes'])
    expect(listState(result).listing.rows.map((r) => r.name)).toEqual(['Alpha'])
  })

  it('keeps the chosen columns when the page size changes', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things?cols=city&cols=likes', db)

    const form = document.querySelector('[data-ac-controls]')!
    const select = form.querySelector('select[name="perPage"]')!
    select.querySelectorAll('option').forEach((o) => o.removeAttribute('selected'))
    select.querySelector('option[value="10"]')!.setAttribute('selected', '')

    const result = await submit(document, form, { adapter: db, config })
    expect(columnKeys(result)).toEqual(['city', 'likes'])
    expect(listState(result).listing.perPage).toBe(10)
  })

  it('keeps the chosen columns across sorting and paging links', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things?cols=city&cols=likes', db)

    const sortLink = document.querySelector('a[data-ac-sort="city"]')!.getAttribute('href')!
    expect(columnKeys(await follow(sortLink, config, db))).toEqual(['city', 'likes'])

    const pageLink = [...document.querySelectorAll('.ac-pagination a')]
      .map((a) => a.getAttribute('href')!)
      .find((href) => href.includes('page=2'))!
    expect(columnKeys(await follow(pageLink, config, db))).toEqual(['city', 'likes'])
  })

  it('clears the search without discarding the view around it', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things?cols=city&cols=likes&q=Alpha', db)

    const clear = document.querySelector('a.ac-toolbar__clear')!.getAttribute('href')!
    const result = await follow(clear, config, db)
    expect(columnKeys(result)).toEqual(['city', 'likes'])
    expect(listState(result).listing.total).toBe(4)
  })
})

describe('sort links', () => {
  it('emit hrefs the engine reads back as the same ordering', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things', db)

    const href = document.querySelector('a[data-ac-sort="likes"]')!.getAttribute('href')!
    const state = listState(await follow(href, config, db))
    expect(state.order).toEqual([{ column: 'likes', dir: 'asc' }])
    expect(state.listing.rows.map((r) => r.likes)).toEqual([1, 5, 7])
  })

  it('toggle direction when the column is already the active sort', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things?sort=likes:asc', db)

    const href = document.querySelector('a[data-ac-sort="likes"]')!.getAttribute('href')!
    expect(listState(await follow(href, config, db)).order).toEqual([{ column: 'likes', dir: 'desc' }])
  })
})

describe('bulk actions', () => {
  it('deletes exactly the rows ticked in the rendered table', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things', db)

    // The checkboxes live in the table and reach the form via `form=`
    const boxes = [...document.querySelectorAll('input[name="ids"]')]
    expect(boxes.map((b) => b.getAttribute('form'))).toEqual(['ac-bulk', 'ac-bulk', 'ac-bulk'])
    tick(boxes[0])
    tick(boxes[2])

    const form = document.querySelector('form#ac-bulk')!
    const button = form.querySelector('button[value="delete"]')!
    const result = await submit(document, form, { adapter: db, config, submitter: button })

    expect(result).toHaveProperty('redirect')
    expect(listState(await visit(config, '/admin/things', db)).listing.rows.map((r) => r.id)).toEqual([2, 4])
  })

  it('does nothing when nothing is ticked', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things', db)

    const form = document.querySelector('form#ac-bulk')!
    await submit(document, form, { adapter: db, config, submitter: form.querySelector('button[value="delete"]')! })
    expect(listState(await visit(config, '/admin/things', db)).listing.total).toBe(4)
  })
})

describe('row actions', () => {
  it('delete posts to a URL the engine acts on', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things', db)

    const form = [...document.querySelectorAll('form.ac-table__action-form')]
      .find((f) => f.getAttribute('action')!.includes('action=delete'))!
    await submit(document, form, { adapter: db, config })

    expect(listState(await visit(config, '/admin/things', db)).listing.rows.map((r) => r.id)).toEqual([2, 3, 4])
  })

  it('edit links reach the edit form for the right row', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things', db)

    const href = [...document.querySelectorAll('a.ac-table__action')]
      .map((a) => a.getAttribute('href')!)
      .find((h) => h.includes('action=edit'))!
    const result = await follow(href, config, db)
    const state = (result as { state: { mode: string; values: Record<string, unknown> } }).state
    expect(state.mode).toBe('form')
    expect(state.values.name).toBe('Alpha')
  })
})

describe('export link', () => {
  it('carries the active search so the file matches the screen', async () => {
    const db = adapter()
    const config = resource()
    const { document } = await load(config, '/admin/things?q=Alpha', db)

    const href = [...document.querySelectorAll('a.ac-controls__button')]
      .map((a) => a.getAttribute('href')!)
      .find((h) => h.includes('action=export'))!
    const result = await follow(href, config, db)

    if (!('response' in result)) throw new Error('expected a CSV response')
    const lines = (await result.response.text()).split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Alpha')
  })
})
