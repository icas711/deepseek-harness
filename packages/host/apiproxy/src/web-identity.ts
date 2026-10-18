/**
 * Per-request web identity for the API gateway: an AsyncLocalStorage the
 * fetch carrier enters with each request's headers, the structural face of
 * the `webAuth` service (provided by the web composition's login-password
 * plugin — `@deepseek-ai/dsh-web-app/webauth`), and the path-containment rule
 * the scoping points share. Non-web callers (TUI, headless, in-process) carry
 * no stored headers and read no identity: every scope degrades to «видно всё».
 * @module ./web-identity.ts
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AdminDeviceView, AdminRole, AdminUserView } from './api/admin.ts'

export type { AdminDeviceView, AdminRole, AdminUserView } from './api/admin.ts'

/** The headers of the web request being served, entered by the fetch carrier. */
const requestHeaders = new AsyncLocalStorage<Headers>()

/**
 * Run one serving pass under the given request headers, so gateway methods
 * can resolve the calling web user's identity.
 * @param headers - the WHATWG Request headers (cookie source).
 * @param run - the serving pass (dispatch, or one SSE stream lifetime).
 * @returns whatever `run` returns.
 */
export function runWithWebRequestHeaders<T>(headers: Headers, run: () => T): T {
  return requestHeaders.run(headers, run)
}

/**
 * The headers of the web request being served, when this call rides one.
 * @returns the stored headers, or undefined outside a web request.
 */
export function currentWebRequestHeaders(): Headers | undefined {
  return requestHeaders.getStore()
}

/**
 * Identity of the authenticated web user. `root` is the canonical path of
 * the user's cabinet — the directory subtree this user's sessions and
 * workspaces must live under; `admin` lifts all scoping.
 */
export interface WebIdentity {
  login: string
  admin: boolean
  /** Canonical (realpath'd) cabinet root of this user. */
  root: string
}

/** Why the web-auth service refused one administration operation. */
export type WebAdminFailure =
  | 'user-not-found'
  | 'user-exists'
  | 'last-admin'
  | 'device-not-found'
  | 'invalid-input'

/** Typed rejection of one administration operation (the service's in-process currency). */
export class WebAdminError extends Error {
  /**
   * @param code - the machine-readable failure kind the gateway narrows to a wire error code.
   * @param message - the human-readable reason (rides the wire error's message).
   */
  constructor(public readonly code: WebAdminFailure, message: string) {
    super(message)
    this.name = 'WebAdminError'
  }
}

/** Input of {@link WebAuthService.createUser}. */
export interface WebCreateUserInput {
  /** The new account's login (the web-auth login charset). */
  login: string
  /** The initial password; the host stores only its scrypt hash. */
  password: string
  /** The new account's role. */
  role: AdminRole
}

/**
 * Service Definition face of the web-auth plugin, consumed by the gateway's
 * scoping points and the admin.* domain. Declared here (with the primary
 * consumer) because the provider is a higher-level composition plugin of the
 * web bundle; the provider imports this face and satisfies it structurally.
 * The administration methods mutate the managed user store and its live
 * sessions; every rejection is a {@link WebAdminError}.
 */
export interface WebAuthService {
  /**
   * Resolve the identity a Cookie header authenticates right now.
   * @param cookie - the raw Cookie header value, or undefined when absent.
   * @returns the identity, or undefined when no live session matches.
   */
  identityFromCookie(cookie: string | undefined): WebIdentity | undefined

  /**
   * Every managed account, ordered by login.
   * @returns the account views without secret material.
   */
  listUsers(): AdminUserView[]

  /**
   * Create an account (host-side scrypt hash) and persist the store.
   * @param input - the login, initial password, and role.
   * @throws WebAdminError `user-exists` / `invalid-input`.
   */
  createUser(input: WebCreateUserInput): Promise<void>

  /**
   * Delete an account and revoke all its sessions.
   * @param login - the account to delete.
   * @throws WebAdminError `user-not-found` / `last-admin`.
   */
  deleteUser(login: string): Promise<void>

  /**
   * Replace one account's password hash and revoke all its sessions.
   * @param login - the account to reset.
   * @param newPassword - the replacement password (stored hashed).
   * @throws WebAdminError `user-not-found` / `invalid-input`.
   */
  resetPassword(login: string, newPassword: string): Promise<void>

  /**
   * Change one account's role; the flag re-reads on every request, so the
   * change lands without touching sessions.
   * @param login - the account to change.
   * @param role - the new role.
   * @throws WebAdminError `user-not-found` / `last-admin`.
   */
  setRole(login: string, role: AdminRole): Promise<void>

  /**
   * One account's live (unexpired) sessions, oldest issuance first.
   * @param login - the account whose devices to list.
   * @returns the device views of that account.
   * @throws WebAdminError `user-not-found`.
   */
  listDevices(login: string): AdminDeviceView[]

  /**
   * Revoke one session of one account.
   * @param login - the account owning the session.
   * @param sessionId - the session to revoke.
   * @throws WebAdminError `user-not-found` / `device-not-found`.
   */
  revokeDevice(login: string, sessionId: string): Promise<void>

  /**
   * Revoke every session of one account.
   * @param login - the account whose devices to revoke.
   * @returns how many sessions were revoked.
   * @throws WebAdminError `user-not-found`.
   */
  revokeAllDevices(login: string): Promise<number>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provided by the web composition's login-password plugin; read via ctx.get (undefined when absent). */
    webAuth: WebAuthService
  }
}

/**
 * Whether a canonical session/workspace path lies inside a user's cabinet.
 * Both sides are canonical realpaths; comparison is case-insensitive on
 * Windows, where realpath preserves the on-disk casing of each component.
 * @param path - the canonical path under test.
 * @param root - the canonical cabinet root.
 * @returns whether the path is the root or lives under it.
 */
export function isWithinRoot(path: string, root: string): boolean {
  const withSep = root.endsWith(sep) ? root : root + sep
  if (process.platform === 'win32') {
    const lowerPath = path.toLowerCase()
    return lowerPath === root.toLowerCase() || lowerPath.startsWith(withSep.toLowerCase())
  }
  /* v8 ignore next -- only one platform arm can run in one process; CI covers the POSIX arm */
  return path === root || path.startsWith(withSep)
}

/**
 * The authenticated web user whose request is being served, whatever their
 * role — the raw identity the role gates (admin.*) and the scoping points
 * (which skip admins) both read.
 * @param ctx - the gateway context (reads the optional webAuth service).
 * @returns the identity, or undefined outside a web request, without the
 * service, or with no live session.
 */
export function requestIdentity(ctx: Context): WebIdentity | undefined {
  const headers = currentWebRequestHeaders()
  const auth = ctx.get('webAuth')
  if (headers === undefined || auth === undefined) return undefined
  return auth.identityFromCookie(headers.get('cookie') ?? undefined)
}

/**
 * The web user whose request is being served, for the gateway's scoping
 * points. Admins and non-web callers return undefined: no scoping applies.
 * @param ctx - the gateway context (reads the optional webAuth service).
 * @returns the identity to scope by, or undefined when nothing scopes.
 */
export function scopingIdentity(ctx: Context): WebIdentity | undefined {
  const identity = requestIdentity(ctx)
  if (identity === undefined || identity.admin) return undefined
  return identity
}
