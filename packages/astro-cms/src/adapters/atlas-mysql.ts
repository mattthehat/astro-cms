import type { MySQLORM } from 'atlas-mysql'
import type { CmsAdapter, CmsFieldMap, CmsRow, ListQuery, MappedError } from '../types'

type DbValue = string | number | boolean | null
type DbError = { code?: string; message?: string }

// atlas-mysql selects via an alias→column fields map; the CMS always selects
// columns under their own name
const fieldsFor = (columns: string[]): Record<string, string> =>
  Object.fromEntries(columns.map((c) => [c, c]))

const asDbRow = (data: CmsRow): Record<string, DbValue> => data as Record<string, DbValue>

/**
 * Translates the engine's search + filter state into atlas WHERE clauses and
 * bound values. Everything is built as raw, fully-parameterised clauses in a
 * known order, so the values array lines up with the `?` placeholders exactly.
 * Column names come from trusted resource config, never from user input.
 */
export const buildListWhere = (q: ListQuery): { where: string[]; values: DbValue[] } => {
  const where: string[] = []
  const values: DbValue[] = []

  if (q.search) {
    where.push(`(${q.search.columns.map((c) => `${c} LIKE ?`).join(' OR ')})`)
    for (const _ of q.search.columns) values.push(`%${q.search.term}%`)
  }

  for (const f of q.filters) {
    if (f.type === 'dateRange') {
      if (f.from) {
        where.push(`${f.column} >= ?`)
        values.push(`${f.from} 00:00:00`)
      }
      if (f.to) {
        where.push(`${f.column} <= ?`)
        values.push(`${f.to} 23:59:59`)
      }
    } else if (f.type === 'present') {
      where.push(`${f.column} IS NOT NULL`)
    } else if (f.type === 'bool') {
      where.push(`${f.column} = ?`)
      values.push(1)
    } else if (f.type === 'select') {
      where.push(`${f.column} = ?`)
      values.push(f.value)
    } else if (f.type === 'nonempty') {
      // "unset" covers both NULL and empty string; "set" is a real value
      if (f.state === 'set') {
        where.push(`(${f.column} IS NOT NULL AND ${f.column} <> ?)`)
        values.push('')
      } else {
        where.push(`(${f.column} IS NULL OR ${f.column} = ?)`)
        values.push('')
      }
    }
  }

  return { where, values }
}

/**
 * The ORDER BY terms for a list query. Prefers the full `order`, falling back
 * to the single `sort` and finally to the id column so paging stays stable.
 */
const orderFor = (q: ListQuery): { column: string; direction: 'ASC' | 'DESC' }[] => {
  const terms = q.order?.length ? q.order : q.sort ? [q.sort] : [{ column: q.idColumn, dir: 'asc' as const }]
  return terms.map((t) => ({ column: t.column, direction: t.dir === 'desc' ? 'DESC' : 'ASC' }))
}

/** MySQL identifier quoting, for the one place we build SQL outside atlas */
const escapeIdent = (name: string): string => `\`${name.replace(/`/g, '``')}\``

/**
 * Turns MySQL constraint errors into friendly messages. Duplicate-key errors
 * are matched against fields with `rules.unique` so the message lands on the
 * right input instead of a generic banner.
 */
export const mapMysqlError = (err: unknown, fields: CmsFieldMap): MappedError => {
  const e = err as DbError

  if (e?.code === 'ER_DUP_ENTRY') {
    // Message looks like: Duplicate entry 'x' for key 'users.email' (or 'email')
    const key = /for key '([^']+)'/.exec(e.message ?? '')?.[1]?.split('.').pop() ?? ''
    for (const [name, field] of Object.entries(fields)) {
      if (field.rules?.unique && key.includes(name)) {
        return { errors: { [name]: [`${field.label ?? name} is already in use`] } }
      }
    }
    return { message: 'One of these values is already in use.' }
  }

  if (e?.code === 'ER_DATA_TOO_LONG') {
    const column = /for column '([^']+)'/.exec(e.message ?? '')?.[1] ?? ''
    const field = fields[column]
    if (field) return { errors: { [column]: [`${field.label ?? column} is too long`] } }
    return { message: 'One of these values is too long.' }
  }

  console.error('Unhandled database error:', err)
  return { message: 'Something went wrong saving your changes. Please try again.' }
}

/** CmsAdapter backed by an atlas-mysql MySQLORM instance */
export const atlasAdapter = (orm: MySQLORM): CmsAdapter => ({
  async findMany(q: ListQuery) {
    const { where, values } = buildListWhere(q)
    const { rows, count } = await orm.getData<CmsRow>(
      {
        table: q.table,
        idField: q.idColumn,
        fields: fieldsFor(q.columns),
        where,
        // atlas escapes these identifiers and applies each direction in turn
        orderBy: orderFor(q),
        limit: q.limit,
        offset: q.offset,
      },
      values
    )
    return { rows, total: count }
  },

  async findOne(table, idColumn, id, columns) {
    return orm.getFirst<CmsRow>({
      table,
      idField: idColumn,
      fields: fieldsFor(columns),
      where: [{ column: idColumn, op: '=', value: id }],
    })
  },

  async create(table, data) {
    return orm.insertData(table, asDbRow(data))
  },

  async update(table, idColumn, id, data) {
    await orm.updateData({ table, data: asDbRow(data), where: [`${idColumn} = ?`], values: [id] })
  },

  async remove(table, idColumn, id) {
    await orm.deleteData(table, { [idColumn]: id })
  },

  async removeMany(table, idColumn, ids) {
    if (ids.length === 0) return
    // deleteData only takes equality pairs, so this one statement is built here.
    // Identifiers come from resource config and are quoted; ids are bound.
    const placeholders = ids.map(() => '?').join(', ')
    await orm.rawQuery(
      `DELETE FROM ${escapeIdent(table)} WHERE ${escapeIdent(idColumn)} IN (${placeholders})`,
      ids as DbValue[]
    )
  },

  mapError: mapMysqlError,
})
