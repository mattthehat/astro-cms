import type { AstroCookies } from 'astro'

/** A flash message rendered once on the next page load */
export type FlashItem = {
  variant: 'success' | 'warning' | 'error' | 'info'
  message: string
  /** Optional link rendered after the message (e.g. a dev invite link) */
  href?: string
}

const FLASH_COOKIE = 'ac_flash'

const readItems = (cookies: AstroCookies): FlashItem[] => {
  const cookie = cookies.get(FLASH_COOKIE)
  if (!cookie) return []
  try {
    // Stored as a JSON string — Astro's cookie API does not JSON-encode objects
    const value = JSON.parse(cookie.value)
    return Array.isArray(value) ? (value as FlashItem[]) : []
  } catch {
    return []
  }
}

/**
 * Queues flash messages for the next request. They live in a short-lived
 * httpOnly cookie (not the URL), so PRG redirects can stay on clean paths.
 */
export const setFlash = (cookies: AstroCookies, items: FlashItem[]): void => {
  if (items.length === 0) return
  cookies.set(FLASH_COOKIE, JSON.stringify([...readItems(cookies), ...items]), {
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
    path: '/',
    maxAge: 60, // a flash never read (tab closed) self-expires quickly
  })
}

/** Reads and clears the queued flash messages — call once where they render */
export const takeFlash = (cookies: AstroCookies): FlashItem[] => {
  const items = readItems(cookies)
  if (cookies.get(FLASH_COOKIE)) cookies.delete(FLASH_COOKIE, { path: '/' })
  return items
}
