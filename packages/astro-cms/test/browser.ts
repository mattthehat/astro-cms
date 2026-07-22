import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { parseHTML } from 'linkedom'
import type { AstroCookies } from 'astro'
import Cms from '../src/components/Cms.astro'
import { runCmsResource } from '../src/cms-resource'
import type { CmsResult, CmsState, ResourceConfig } from '../src/cms-resource'
import type { CmsAdapter } from '../src/types'

// A minimal browser: render the real components, then replay the forms and
// links they emit. Tests that build request shapes by hand can pass while the
// UI emits something different — this closes that gap.

export const fakeCookies = () => {
  const store = new Map<string, string>()
  return {
    get: (name: string) => (store.has(name) ? { value: store.get(name)! } : undefined),
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name),
    has: (name: string) => store.has(name),
    store,
  } as unknown as AstroCookies & { store: Map<string, string> }
}

const ORIGIN = 'http://localhost'

/** Runs the engine for a URL, exactly as a consumer page would */
export const visit = (config: ResourceConfig, path: string, adapter: CmsAdapter): Promise<CmsResult> => {
  const url = new URL(path, ORIGIN)
  return runCmsResource(config, { request: new Request(url), url, cookies: fakeCookies(), adapter })
}

/** Renders <Cms> for a path and returns the resulting document */
export const load = async (config: ResourceConfig, path: string, adapter: CmsAdapter) => {
  const result = await visit(config, path, adapter)
  if (!('state' in result)) throw new Error(`expected a page to render at ${path}`)

  const url = new URL(path, ORIGIN)
  const container = await AstroContainer.create()
  const html = await container.renderToString(Cms, {
    props: { config, state: result.state as CmsState, url },
    request: new Request(url),
  })
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  return { document, state: result.state as CmsState, url }
}

type El = ReturnType<ReturnType<typeof parseHTML>['document']['querySelector']>

/**
 * The controls a form submits: those inside it, plus any elsewhere in the
 * document pointing at it with the `form` attribute — which is how the bulk
 * checkboxes reach their form without nesting inside the row-action forms.
 */
const controlsOf = (document: Document, form: Element): Element[] => {
  const inside = [...form.querySelectorAll('input, select, textarea')]
  const associated = form.id ? [...document.querySelectorAll(`[form="${form.id}"]`)] : []
  return [...new Set([...inside, ...associated])]
}

/** Serialises a form the way a browser would, honouring only successful controls */
export const serialise = (document: Document, form: Element, submitter?: El): URLSearchParams => {
  const params = new URLSearchParams()

  for (const el of controlsOf(document, form)) {
    const name = el.getAttribute('name')
    if (!name || el.hasAttribute('disabled')) continue
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()

    if (type === 'checkbox' || type === 'radio') {
      if (el.hasAttribute('checked')) params.append(name, el.getAttribute('value') ?? 'on')
      continue
    }
    // A submit control only counts when it is the one that submitted
    if (type === 'submit' || type === 'button' || el.tagName === 'BUTTON') continue

    if (el.tagName === 'SELECT') {
      const option = el.querySelector('option[selected]') ?? el.querySelector('option')
      if (option) params.append(name, option.getAttribute('value') ?? option.textContent ?? '')
      continue
    }
    params.append(name, el.getAttribute('value') ?? '')
  }

  const submitterName = submitter?.getAttribute('name')
  if (submitterName) params.append(submitterName, submitter!.getAttribute('value') ?? '')

  return params
}

/**
 * Submits a form through the engine. A GET submission replaces the whole query
 * string — the browser behaviour that decides whether state a form does not own
 * survives — while POST sends a body.
 */
export const submit = async (
  document: Document,
  form: Element,
  { adapter, config, submitter }: { adapter: CmsAdapter; config: ResourceConfig; submitter?: El }
): Promise<CmsResult> => {
  const method = (form.getAttribute('method') ?? 'get').toUpperCase()
  const params = serialise(document, form, submitter)
  const url = new URL(form.getAttribute('action') ?? '/', ORIGIN)

  if (method === 'GET') {
    url.search = params.toString()
    return runCmsResource(config, { request: new Request(url), url, cookies: fakeCookies(), adapter })
  }

  const request = new Request(url, { method: 'POST', body: params })
  return runCmsResource(config, { request, url, cookies: fakeCookies(), adapter })
}

/** Follows a link from the rendered page */
export const follow = (href: string, config: ResourceConfig, adapter: CmsAdapter): Promise<CmsResult> => {
  const url = new URL(href, ORIGIN)
  return visit(config, url.pathname + url.search, adapter)
}

/** Ticks a checkbox, mirroring how the server-rendered `checked` attribute reads */
export const tick = (el: El, on = true): void => {
  if (!el) throw new Error('no such control')
  if (on) el.setAttribute('checked', '')
  else el.removeAttribute('checked')
}

export const listState = (result: CmsResult) => {
  const state = (result as { state: CmsState }).state
  if (!state || state.mode !== 'list') throw new Error(`expected a list, got ${state?.mode ?? 'redirect'}`)
  return state
}
