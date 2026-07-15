import { describe, expect, it } from 'vitest'
import {
  formConfigFor,
  rowFromForm,
  rowToFormValues,
  searchableColumns,
  selectColumns,
  sortableColumns,
  tableColumns,
  toInputValue,
  viewItemsFor,
} from '../src/cms'
import type { CmsFieldMap } from '../src/types'

const fields: CmsFieldMap = {
  title: { label: 'Title', list: true, search: true, sort: true },
  email: { label: 'Email', type: 'email', search: true },
  price: { label: 'Price', type: 'number', list: { format: 'currency' }, sort: true },
  live: { label: 'Live', type: 'switch', list: { format: 'bool' } },
  starts: { label: 'Starts', type: 'datetime-local', list: { format: 'datetime' } },
  slug: { label: 'Slug', edit: false },
  internal: { label: 'Internal', add: false, view: false },
  computed: { label: 'Computed', virtual: true },
}

describe('tableColumns', () => {
  it('includes only fields marked list, with labels and sortability', () => {
    const cols = tableColumns(fields)
    expect(cols.map((c) => c.key)).toEqual(['title', 'price', 'live', 'starts'])
    expect(cols[0]).toMatchObject({ label: 'Title', sortable: true })
    expect(cols[2].sortable).toBe(false)
  })

  it('centres bool columns and applies the named formats', () => {
    const cols = tableColumns(fields)
    const live = cols.find((c) => c.key === 'live')!
    expect(live.align).toBe('centre')
    expect(live.format!(1, {})).toMatchObject({ icon: 'lucide:check', iconVariant: 'success' })
    expect(live.format!(0, {})).toMatchObject({ icon: 'lucide:x', iconVariant: 'error' })

    const price = cols.find((c) => c.key === 'price')!
    expect(price.format!(38.5, {})).toBe('£38.50')
    expect(price.format!(null, {})).toBe('—')
  })

  it('applies pill/prefix/suffix decoration from the column config', () => {
    const cols = tableColumns({ city: { list: { pill: 'primary', prefix: '@' } } })
    expect(cols[0].format!('London', {})).toEqual({ text: 'London', pill: 'primary', prefix: '@' })
  })
})

describe('formConfigFor', () => {
  it('includes fields by mode: add excludes add:false, edit excludes edit:false', () => {
    expect(Object.keys(formConfigFor(fields, 'add').fields)).not.toContain('internal')
    expect(Object.keys(formConfigFor(fields, 'add').fields)).toContain('slug')
    expect(Object.keys(formConfigFor(fields, 'edit').fields)).not.toContain('slug')
    expect(Object.keys(formConfigFor(fields, 'edit').fields)).toContain('internal')
  })

  it('switches to multipart when a file field is included', () => {
    const withFile: CmsFieldMap = { doc: { type: 'file' } }
    expect(formConfigFor(withFile, 'add').enctype).toBe('multipart/form-data')
    expect(formConfigFor(fields, 'add').enctype).toBeUndefined()
  })
})

describe('rowFromForm (coerceValue)', () => {
  it('coerces by field type and skips virtual/unknown fields', () => {
    const row = rowFromForm(
      {
        title: '  Hello  ',
        email: 'USER@Example.COM',
        price: '38.5',
        live: true,
        starts: '2026-09-01T20:00',
        computed: 'derived',
        unknown: 'x',
      },
      fields
    )
    expect(row).toEqual({
      title: 'Hello',
      email: 'user@example.com',
      price: 38.5,
      live: 1,
      starts: '2026-09-01 20:00:00',
    })
  })

  it('maps empty strings to null (and empty numbers too)', () => {
    const row = rowFromForm({ title: '', price: '', live: false, starts: '' }, fields)
    expect(row).toEqual({ title: null, price: null, live: 0, starts: null })
  })
})

describe('toInputValue / rowToFormValues', () => {
  const date = new Date(2026, 8, 1, 20, 5) // 1 Sep 2026 20:05 local

  it('formats Dates for each input type', () => {
    expect(toInputValue(date, 'date')).toBe('2026-09-01')
    expect(toInputValue(date, 'time')).toBe('20:05')
    expect(toInputValue(date, 'datetime-local')).toBe('2026-09-01T20:05')
    expect(toInputValue(null)).toBe('')
  })

  it('maps a row to form values using field types', () => {
    const values = rowToFormValues({ title: 'Hello', live: 1, starts: date, missing: 'x' }, fields)
    expect(values).toEqual({ title: 'Hello', live: true, starts: '2026-09-01T20:05' })
  })
})

describe('viewItemsFor', () => {
  it('excludes view:false fields and formats values', () => {
    const items = viewItemsFor({ title: 'Hello', live: 1, price: 10 }, fields)
    expect(items.map((i) => i.key)).not.toContain('internal')
    // `live` has a bool list format, so the view reuses the tick icon
    expect(items.find((i) => i.key === 'live')!.value).toMatchObject({ icon: 'lucide:check', label: 'Yes' })
    expect(items.find((i) => i.key === 'price')!.value).toBe('£10.00')
    expect(items.find((i) => i.key === 'title')!.label).toBe('Title')
  })
})

describe('column helpers', () => {
  it('selectColumns is id + non-virtual fields, deduped', () => {
    expect(selectColumns(fields, 'id')).toEqual([
      'id', 'title', 'email', 'price', 'live', 'starts', 'slug', 'internal',
    ])
    expect(selectColumns({ id: { label: 'ID' } }, 'id')).toEqual(['id'])
  })

  it('searchable/sortable columns follow the flags', () => {
    expect(searchableColumns(fields)).toEqual(['title', 'email'])
    expect(sortableColumns(fields)).toEqual(['title', 'price'])
  })
})
