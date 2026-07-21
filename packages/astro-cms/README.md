# @mattthehat/astro-cms

A config-driven admin CMS for Astro, built on
[`@mattthehat/astro-forms`](https://www.npmjs.com/package/@mattthehat/astro-forms).
One resource configuration object drives a complete list/create/edit/view/delete
admin screen: a sortable, searchable, filterable, paginated table; create and edit
forms rendered and validated by astro-forms; a read-only detail view; and lifecycle
hooks around persistence.

The database is reached through a small adapter interface, so the core is entirely
database-agnostic. An official [atlas-mysql](https://www.npmjs.com/package/atlas-mysql)
adapter ships as a subpath export, alongside an in-memory adapter for prototyping
and tests.

- One `defineResource` config: fields drive the forms, the table columns, the detail
  view, search and sort — no duplication between screens.
- Filters (select, date range, boolean, presence, set/unset) declared per resource
  and translated by the adapter.
- Lifecycle hooks: transform rows before insert/update, block deletes, override
  redirects, and register custom POST actions.
- `canCreate` gate and pluggable row actions for per-user permissions.
- Flash messages over a redirect (POST → redirect → GET), no client state.
- Zero runtime dependencies; icons are inline SVG. Styles ship precompiled; theming
  via `--ac-*` CSS custom properties.
- Works without client-side JavaScript: plain forms, links and redirects.

## Installation

```sh
pnpm add @mattthehat/astro-cms @mattthehat/astro-forms
# or: npm install @mattthehat/astro-cms @mattthehat/astro-forms
```

Astro `^6.4.5` and `@mattthehat/astro-forms ^0.1.0` are peer dependencies. The CMS
handles POSTs, so its pages must be server-rendered (`output: 'server'`, or
`prerender = false` on the page). `atlas-mysql` is an optional peer dependency —
install it only if you use the atlas adapter.

## Quick start

A complete admin screen. `runCmsResource` executes the request (list, form render,
create, update, delete, custom action) and either redirects or returns view state
for `<Cms />`.

```astro
---
// src/pages/admin/gigs.astro
import { Cms, runCmsResource, defineResource } from '@mattthehat/astro-cms';
import { atlasAdapter } from '@mattthehat/astro-cms/adapters/atlas-mysql';
import Admin from '../../layouts/Admin.astro';
import { orm } from '../../lib/db';
import '@mattthehat/astro-forms/styles.css';
import '@mattthehat/astro-cms/styles.css';

const gigs = defineResource({
  table: 'gigs',
  idColumn: 'id',
  basePath: '/admin/gigs',
  singular: 'gig',
  defaultSort: { column: 'date', dir: 'asc' },
  fields: {
    artist: { label: 'Artist', rules: { required: true }, list: true, search: true, sort: true },
    venue:  { label: 'Venue', rules: { required: true }, list: true, search: true },
    date:   { label: 'Date', type: 'datetime-local', rules: { required: true }, list: { format: 'datetime' }, sort: true },
    price:  { label: 'Price', type: 'number', step: '0.01', list: { format: 'currency' }, sort: true },
    sold_out: { label: 'Sold out', type: 'switch', list: { format: 'bool' } },
  },
  filters: [
    { type: 'dateRange', key: 'date', label: 'Date', column: 'date' },
    { type: 'bool', key: 'sold_out', label: 'Sold out only', column: 'sold_out' },
  ],
});

const result = await runCmsResource(gigs, {
  request: Astro.request,
  url: Astro.url,
  cookies: Astro.cookies,
  adapter: atlasAdapter(orm),
});

if ('redirect' in result) return Astro.redirect(result.redirect);
---

<Admin title="Gigs">
  <Cms config={gigs} state={result.state} url={Astro.url} />
</Admin>
```

That one page now serves the whole resource: `/admin/gigs` lists, `?action=new`
creates, `?action=edit&id=7` edits, `?action=view&id=7` shows the detail screen and
a POST to `?action=delete&id=7` deletes.

`<Cms />` renders bare — a single `div.ac-cms` with no app chrome — so you wrap it
in your own layout and navigation.

## Fields

A CMS field is an astro-forms
[`FieldConfig`](https://www.npmjs.com/package/@mattthehat/astro-forms) (label, type,
rules, options, widths…) plus flags that drive the admin screens:

| Flag | Effect |
| --- | --- |
| `list` | Show as a table column. `true`, or a `ColumnConfig` (below). |
| `search` | Include in the free-text search. |
| `sort` | Render the column header as a sort toggle. |
| `add` / `edit` | Include on the create / edit form. Default `true`. |
| `view` | Include on the detail screen. Default `true`. |
| `virtual` | Not a database column — excluded from SELECTs and persisted rows. |
| `compute` | Derive the value from the row after the read. Implies `virtual`. |
| `hidden` | Listed, but off by default — users switch it on in the column picker. |
| `export` | Set `false` to keep a listed column out of the CSV export. |

Everything astro-forms supports works here: validation rules produce inline errors
with repopulated values, `type: 'file'` switches the form to multipart, custom field
components keep working.

### List columns

Pass an object to `list` to control the rendering:

```ts
price:  { label: 'Price', type: 'number', list: { format: 'currency' } },
status: { label: 'Status', type: 'select', options: statuses, list: { pill: 'primary' } },
fee:    { label: 'Fee', type: 'number', list: { suffix: '%' } },
owner:  { label: 'Owner', list: { decorate: (value, row) => ({ text: String(value), pill: row.active ? 'success' : 'neutral' }) } },
```

- `format` — `'text' | 'date' | 'datetime' | 'bool' | 'currency'`. `bool` renders a
  tick or cross icon; `date`/`datetime` format `Date` values; `currency` formats
  numbers.
- `pill`, `prefix`, `suffix` — wrap or annotate the formatted value.
- `decorate(value, row)` — full control; return a string or a
  `CellContent` (`{ text, pill, icon, iconVariant, prefix, suffix, label }`).
- `label` — override the column heading (defaults to the field label).

### Computed columns

`compute` derives a value from the row once it has been read. The field is never
selected from the database and never persisted, so it is how a virtual field earns
a place in the table, the detail screen and the CSV export:

```ts
billing: {
  label: 'Billing',
  list: true,
  compute: (row) => `${row.artist} — ${row.venue}, ${row.city}`,
},
```

### Sorting

Clicking a `sort: true` header orders by that column; **shift-clicking** adds a
column to the ordering rather than replacing it, and each active header shows its
rank. The state lives in the query string as `?sort=city:asc,price:desc`, so a
sorted view is shareable. The older `?sort=city&dir=asc` form still works.

Adapters receive the full ordering as `order`, with `order[0]` mirrored into `sort`
so an adapter written before multi-column sort keeps working.

### Page size, columns and export

```ts
perPageOptions: [10, 25, 50],   // renders a page-size picker
csv: true,                      // or { filename: 'gigs.csv', maxRows: 5000 }
```

`?perPage=` only accepts a value from `perPageOptions`, so the query string cannot
ask for an unbounded page. The column picker writes `?cols=`, and the CSV export
covers every row matching the current search, filters and ordering — not just the
page on screen. Enabling `csv` means `runCmsResource` can return a `Response`:

```ts
if ('redirect' in result) return Astro.redirect(result.redirect);
if ('response' in result) return result.response;
```

## Filters

Declared per resource; the toolbar renders them and the adapter translates the
active ones. `column` always comes from your config, never from the URL.

```ts
filters: [
  { type: 'select', key: 'city', label: 'City', column: 'city', options: cities },
  { type: 'dateRange', key: 'date', label: 'Date', column: 'date' },
  { type: 'bool', key: 'live', label: 'Live only', column: 'live' },
  { type: 'present', key: 'paid', label: 'Has payment', column: 'paid_at' },
  { type: 'nonempty', key: 'bio', label: 'Bio', column: 'bio', setLabel: 'Has bio', unsetLabel: 'No bio' },
],
```

`filters` can also be an async function returning the array — useful when the
options come from the database.

## Hooks

Hooks wrap the default persistence. `before*` hooks can transform the row;
returning a path from any hook overrides the default redirect.

```ts
hooks: {
  beforeInsert: (row, ctx) => ({ ...row, created_by: ctx.user?.id ?? null }),
  afterInsert: (id, data, ctx) => {
    ctx.flash([{ variant: 'info', message: `Invite sent to ${data.email}` }]);
    return `/admin/users?action=view&id=${id}`;
  },
  beforeDelete: (id, ctx) => {
    if (id === ctx.user?.id) {
      ctx.flash([{ variant: 'error', message: 'You cannot delete yourself.' }]);
      return '/admin/users'; // returning a path blocks the delete
    }
  },
  // Custom POST handlers, keyed by ?action=
  actions: {
    resend: async (id, ctx) => {
      await resendInvite(id);
      ctx.flash([{ variant: 'success', message: 'Invite resent.' }]);
      return '/admin/users';
    },
  },
},
```

The `data` argument to `afterInsert`/`afterUpdate` is typed from your field map —
a `switch` field arrives as `boolean`, a multi-`select` as `string[]`.

### Permissions

```ts
canCreate: (ctx) => ctx.user?.role === 'admin',
canEdit: (ctx) => ctx.user?.role === 'admin',
canDelete: (ctx) => ctx.user?.role === 'admin',
rowActions: (ctx) => [
  { label: 'View', icon: 'lucide:eye', href: (row) => `/admin/gigs?action=view&id=${row.id}` },
  ...(ctx.user?.role === 'admin' ? defaultRowActions : []),
],
```

`canCreate` hides the "New" button and blocks the create form and its POST
server-side. `canEdit` does the same for editing: when it returns false the Edit
row action and the view screen's Edit CTA are hidden, and the edit form/POST is
blocked server-side — set `canEdit: () => false` for a read-only resource.
`canDelete` hides the Delete row action and rejects the delete POST before the
adapter is touched. Each gate is enforced server-side, not just in the UI, so a
hand-crafted POST is refused too.

`rowActions` replaces the default Edit/Delete pair; entries are links
(`href`) or POST forms (`formAction`, with optional `confirm`), and `show(row)`
hides an action per row. Note that a custom `rowActions` takes over completely —
it is not filtered by the gates, so apply them yourself as in the example above.

### Bulk actions

Selection checkboxes appear as soon as there is a bulk action to run. By default
that is a single Delete, offered whenever `canDelete` allows it. Replace the set to
add your own, and handle them in `hooks.bulk`:

```ts
bulkActions: () => [
  { key: 'delete', label: 'Delete selected', icon: 'lucide:trash-2', variant: 'danger',
    confirm: 'Delete {n} gigs? This cannot be undone.' },
  { key: 'publish', label: 'Publish', variant: 'primary' },
],
hooks: {
  bulk: {
    publish: async (ids, ctx) => {
      await publishAll(ids);
      ctx.flash([{ variant: 'success', message: `${ids.length} published.` }]);
    },
  },
},
```

Return `[]` from `bulkActions` to turn selection off entirely. `{n}` in a `confirm`
is replaced with the number selected. The `delete` key is handled for you unless
you define it in `hooks.bulk`. Bulk delete uses the adapter's optional `removeMany`
when it has one, and otherwise falls back to one `remove` per id.

### Soft delete

```ts
softDelete: { column: 'deleted_at' },
```

Deleting then stamps that column instead of issuing a DELETE. Those rows drop out
of the list, and a Deleted tab appears where they can be restored — or removed for
real. A soft-deleted row is treated as missing if someone reaches its view or edit
URL directly.

This rides on the existing `nonempty` filter rather than a new adapter concept, so
every adapter that implements `CmsAdapter` supports it without changes.

### Timestamps and concurrency

```ts
timestamps: { created: 'created_at', updated: 'updated_at' },
concurrency: { column: 'updated_at' },
```

`timestamps` stamps both columns on insert and `updated` on every edit.
`concurrency` guards against two people editing the same row: the edit form carries
the row's current version, and a save is refused if the row changed in the
meantime. The user gets their input back with an explanation and a fresh token
rather than silently overwriting the other person's work. Any column that changes
on write does the job — an `updated_at` timestamp or an integer version counter.

### Cross-site request forgery

Every mutation is a same-origin form POST to an on-demand rendered page, which
Astro's built-in `security.checkOrigin` already rejects when it comes from
another origin. That defaults to `true`, so there is nothing to configure and
this package adds no token of its own. If you have turned it off globally, turn
it back on for your admin routes.

### Identifiers

`idColumn` need not be an integer. Digit-only ids are passed to the adapter as
numbers; anything else — UUIDs, slugs — is passed through as a string and
escaped into the action URLs.

## Adapters

The engine only ever talks to a `CmsAdapter`, so the core never emits SQL:

```ts
interface CmsAdapter {
  findMany(q: ListQuery): Promise<{ rows: CmsRow[]; total: number }>
  findOne(table: string, idColumn: string, id: CmsId, columns: string[]): Promise<CmsRow | null>
  create(table: string, data: CmsRow): Promise<CmsId>
  update(table: string, idColumn: string, id: CmsId, data: CmsRow): Promise<void>
  remove(table: string, idColumn: string, id: CmsId): Promise<void>
  mapError(err: unknown, fields: CmsFieldMap): MappedError
}
```

`ListQuery` carries the SELECT columns, the trimmed search term and its columns, the
active `FilterState[]` (already parsed from the URL by the engine), the sort and the
page window. `mapError` turns a thrown persistence error into field-level errors
and/or a form-level message; return `{ errors: { email: ['Email is already in use'] } }`
to land a message on an input.

### atlas-mysql

```ts
import { atlasAdapter } from '@mattthehat/astro-cms/adapters/atlas-mysql';
import { MySQLORM } from 'atlas-mysql';

const orm = new MySQLORM({ host, user, password, database });
const adapter = atlasAdapter(orm);
```

Search and filters become fully parameterised WHERE clauses. MySQL constraint
errors are mapped onto the form: `ER_DUP_ENTRY` finds the field with
`rules: { unique: true }` whose name appears in the violated key; `ER_DATA_TOO_LONG`
lands on the named column.

### memory

```ts
import { memoryAdapter } from '@mattthehat/astro-cms/adapters/memory';

const adapter = memoryAdapter({
  gigs: [{ id: 1, artist: 'Slowdive', venue: 'Roundhouse' /* … */ }],
});
```

Plain arrays with search, all five filter types, sort and pagination — no database.
It powers this repo's playground and tests, and is handy for prototyping a resource
before the schema exists. State lives for the adapter instance's lifetime.

### Writing your own

Implement the six required methods for your backend (Postgres, SQLite, an HTTP
API…) and pass the instance to `runCmsResource`. The adapter contract test in
`packages/astro-cms/test/adapters.test.ts` shows the exact expected behaviour —
point it at your adapter to check it.

`removeMany` is optional: implement it to delete a selection in one statement,
or leave it out and the engine issues one `remove` per id instead.

In `findMany`, prefer `q.order` (the full ordering, most significant first) over
`q.sort` (its first term, kept so older adapters still work).

## Theming

Styles ship precompiled. Import once and override the `--ac-*` custom properties;
every value has a baked-in fallback, so nothing is required:

```astro
import '@mattthehat/astro-cms/styles.css';
```

```css
:root {
  --ac-primary: #0f766e;
  --ac-primary-dark: #115e59;
  --ac-on-primary: #ffffff;
  --ac-surface: #ffffff;
  --ac-border: #e5e7eb;
  --ac-text: #111827;
  --ac-text-muted: #6b7280;
  --ac-success: #16a34a;
  --ac-warning: #d97706;
  --ac-error: #dc2626;
  --ac-radius: 4px;
  --ac-radius-lg: 8px;
}
```

The SCSS source is also exported (`@mattthehat/astro-cms/styles.scss`) if you prefer
to compile it yourself. Pair it with astro-forms' `--af-*` variables to theme the
forms to match.

## API

### `runCmsResource(config, ctx)`

Executes the current request for a resource. `ctx` is
`{ request, url, cookies, adapter, user? }`. Returns `{ redirect: string }` (act on
it with `Astro.redirect`) or `{ state: CmsState }` (pass to `<Cms />`).

### `<Cms config state url />`

Renders the screen for a `CmsState`: the list (toolbar, table, pagination), the
create/edit form, or the detail view — plus any queued flash messages. Renders bare
inside `div.ac-cms`; bring your own layout.

### `defineResource(config)`

Identity helper that preserves the field map's type so hook `data` and adapter rows
are inferred.

### Flash messages

`runCmsResource` queues flash messages on its redirects and `<Cms />` renders them
once. The helpers are exported (`setFlash(cookies, items)` / `takeFlash(cookies)`)
if your hooks or surrounding pages want to queue their own.

## License

MIT
