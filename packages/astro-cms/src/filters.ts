import type { FilterState } from './types'

/**
 * A configurable CMS filter. `column` is a trusted DB column from the page's
 * config (never user input); adapters must bind values as parameters.
 */
export type FilterDef =
  | { type: 'dateRange'; key: string; label: string; column: string }
  | { type: 'present'; key: string; label: string; column: string }
  | { type: 'bool'; key: string; label: string; column: string }
  | { type: 'select'; key: string; label: string; column: string; options: { value: string; label: string }[] }
  // Tri-state on a NOT-NULL text column: "set" (non-empty) vs "unset" (empty)
  | { type: 'nonempty'; key: string; label: string; column: string; setLabel?: string; unsetLabel?: string }

export type CmsFilters = FilterDef[]

/**
 * Translates the current query string into the DB-agnostic filter state the
 * adapter receives. Only filters that are actually active appear; the column
 * always comes from the trusted filter config, never from the URL.
 */
export const filterStatesFrom = (params: URLSearchParams, filters: CmsFilters = []): FilterState[] => {
  const states: FilterState[] = []

  for (const f of filters) {
    if (f.type === 'dateRange') {
      const from = params.get(`${f.key}_from`) || undefined
      const to = params.get(`${f.key}_to`) || undefined
      if (from || to) states.push({ type: 'dateRange', column: f.column, from, to })
    } else if (f.type === 'present') {
      // Checkbox: only narrows to rows that have a value when ticked
      if (params.get(f.key) === '1') states.push({ type: 'present', column: f.column })
    } else if (f.type === 'bool') {
      // Checkbox: only narrows to true rows when ticked
      if (params.get(f.key) === '1') states.push({ type: 'bool', column: f.column })
    } else if (f.type === 'select') {
      const v = params.get(f.key)
      if (v) states.push({ type: 'select', column: f.column, value: v })
    } else if (f.type === 'nonempty') {
      const v = params.get(f.key)
      if (v === 'set' || v === 'unset') states.push({ type: 'nonempty', column: f.column, state: v })
    }
  }

  return states
}

/** True when any search/filter param is currently set (for a "Clear" affordance) */
export const hasActiveFilters = (
  params: URLSearchParams,
  searchColumns: string[],
  filters: CmsFilters = []
): boolean => {
  if (searchColumns.length > 0 && params.get('q')?.trim()) return true
  return filters.some((f) =>
    f.type === 'dateRange'
      ? !!(params.get(`${f.key}_from`) || params.get(`${f.key}_to`))
      : !!params.get(f.key)
  )
}
