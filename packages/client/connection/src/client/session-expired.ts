/**
 * Recovery for an ended web session. The login-password gate answers
 * unauthenticated API calls with a plain 401, so the browser surface lands
 * on the login page instead of surfacing a dead transport. Applies only to
 * the real page (jsdom/node callers have no location and are left alone).
 */

/**
 * Assign the login page when a response reports the session gone.
 * @param status - the HTTP status of a completed browser fetch.
 */
export function redirectToLoginWhenUnauthorized(status: number): void {
  if (status !== 401) return
  const page = (globalThis as { location?: { assign(url: string): void } }).location
  page?.assign('/login')
}
