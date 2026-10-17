/**
 * Login-password authentication for the Web composition: the webserver auth
 * seat, the `/login` and `/logout` routes, the managed user store
 * (`web-users.json` in dsh-home), persistent server-side sessions (several
 * per login up to `maxSessionsPerUser`, 30 days, surviving restarts), a
 * per-IP brute-force pause, HTTP Basic for non-interactive clients, and the
 * `webAuth` service — the identity face the API gateway scopes session and
 * workspace visibility by, plus the account/device administration methods
 * the gateway's admin.* domain serves. Composed only through the bundle
 * patch. `DSH_WEB_USERS`/`DSH_WEB_ADMINS` are the first-boot seed and the
 * access-recovery source: an empty store plus a blank environment leaves the
 * plugin passive (open server, no identity service, no logout control).
 * @module @deepseek-ai/dsh-web-app/webauth
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { WebAuth } from '@deepseek-ai/dsh-host-webserver'
import {
  WebAdminError,
  type AdminDeviceView,
  type AdminRole,
  type AdminUserView,
  type WebCreateUserInput,
  type WebIdentity,
} from '@deepseek-ai/dsh-host-apiproxy/web-identity'
import type {} from '@deepseek-ai/dsh-workspace'

/** Stable Cordis plugin name. */
export const name = 'web-auth'

/** The webserver whose auth seat this plugin claims. */
export const inject = ['webServer']

/** Cookie carrying the server-side session id. */
const SESSION_COOKIE = 'dsh_web_session'

/** One stored session record; the id is the only value the client ever holds. */
interface StoredSession {
  id: string
  login: string
  issuedAt: number
  expiresAt: number
  /** Revision of the user's password hash this session was minted under. */
  rev: string
  /** When the session last authenticated a request; the eviction clock. */
  lastSeenAt: number
}

/** On-disk shape of the session store. */
interface SessionStoreFile {
  version: 2
  sessions: StoredSession[]
}

/** One managed account record on disk (the store format owns the hash parameters). */
export interface StoredUser {
  login: string
  /** `scrypt$N$r$p$<salt-hex>$<key-hex>`, same format the env seed carries. */
  scryptHash: string
  role: AdminRole
  /** Epoch milliseconds of the seed or `createUser` moment. */
  createdAt: number
}

/** On-disk shape of the user store. */
interface UserStoreFile {
  version: 1
  users: StoredUser[]
}

/** Login-charset: names double as cabinet directory names, so they are plain segments. */
const LOGIN_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

/** scrypt parameters baked into every stored hash; the format owns them, not config. */
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32

/** Bounds of a created or reset password; the admin.* wire schemas mirror them. */
const PASSWORD_MIN = 8
const PASSWORD_MAX = 256

/**
 * How rarely a request-time `lastSeenAt` refresh reaches the disk; logins
 * and logouts save immediately regardless. A crash loses at most this much
 * staleness, which costs at most evicting a session that was in fact seen
 * moments before the crash.
 */
const LAST_SEEN_FLUSH_MS = 60_000

/** A parsed `scrypt$N$r$p$saltHex$keyHex` record. */
interface ScryptRecord { N: number; r: number; p: number; salt: Buffer; key: Buffer }

/**
 * Parse one scrypt hash string.
 * @param text - the stored hash, `scrypt$N$r$p$<salt-hex>$<key-hex>`.
 * @param source - description of where the hash came from, for error text.
 * @returns the parsed parameters and key material.
 * @throws when the format or parameter ranges are wrong (misconfiguration fails loud).
 */
function parseScrypt(text: string, source: string): ScryptRecord {
  const parts = text.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    throw new Error(`web-auth: ${source}: expected "scrypt$N$r$p$saltHex$keyHex", got "${text}"`)
  }
  const [, nText, rText, pText, saltHex, keyHex] = parts as [string, string, string, string, string, string]
  const N = Number(nText)
  const r = Number(rText)
  const p = Number(pText)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N < 2 || r < 1 || p < 1) {
    throw new Error(`web-auth: ${source}: scrypt parameters must be positive integers, got "${text}"`)
  }
  const salt = Buffer.from(saltHex, 'hex')
  const key = Buffer.from(keyHex, 'hex')
  if (salt.length === 0 || key.length === 0) {
    throw new Error(`web-auth: ${source}: empty salt or key in "${text}"`)
  }
  return { N, r, p, salt, key }
}

/**
 * Verify one password against one parsed record, timing-safely.
 * @param password - the presented password.
 * @param record - the parsed stored hash.
 * @returns whether the password matches.
 */
function matchesRecord(password: string, record: ScryptRecord): boolean {
  const computed = scryptSync(password, record.salt, record.key.length,
    { N: record.N, r: record.r, p: record.p, maxmem: 256 * 1024 * 1024 })
  return timingSafeEqual(createHash('sha256').update(computed).digest(), createHash('sha256').update(record.key).digest())
}

/**
 * Hash one password with the store's baked scrypt parameters and a fresh salt.
 * @param password - the plaintext to hash (the store never sees it again).
 * @returns the stored hash string.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, SCRYPT_KEYLEN,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 256 * 1024 * 1024 })
  return `scrypt$${String(SCRYPT_N)}$${String(SCRYPT_R)}$${String(SCRYPT_P)}$${salt.toString('hex')}$${key.toString('hex')}`
}

/** One parsed `login:hash` entry: the raw string (the revision source) plus its parsed record. */
export interface ParsedUser {
  login: string
  /** The raw stored hash; its sha256 is the session revision. */
  hash: string
  record: ScryptRecord
  revision: string
}

/**
 * Parse `DSH_WEB_USERS` value: comma-separated `login:hash` pairs.
 * @param users - the raw config value (non-blank).
 * @returns the parsed entries keyed by login.
 * @throws on any malformed entry or duplicate login.
 */
export function parseUsers(users: string): Map<string, ParsedUser> {
  const entries = new Map<string, ParsedUser>()
  for (const rawEntry of users.split(',')) {
    const entry = rawEntry.trim()
    if (entry === '') throw new Error('web-auth: DSH_WEB_USERS holds an empty entry')
    const at = entry.indexOf(':')
    if (at <= 0 || at === entry.length - 1) {
      throw new Error(`web-auth: DSH_WEB_USERS entry "${entry}" is not "login:hash"`)
    }
    const login = entry.slice(0, at)
    const hash = entry.slice(at + 1)
    if (!LOGIN_PATTERN.test(login)) {
      throw new Error(`web-auth: login "${login}" must match ${String(LOGIN_PATTERN)}`)
    }
    if (entries.has(login)) throw new Error(`web-auth: DSH_WEB_USERS lists login "${login}" twice`)
    const record = parseScrypt(hash, `hash of "${login}"`)
    entries.set(login, { login, hash, record, revision: createHash('sha256').update(hash).digest('hex') })
  }
  return entries
}

/**
 * Parse `DSH_WEB_ADMINS`: comma-separated logins.
 * @param admins - the raw config value (non-blank).
 * @returns the admin login set.
 * @throws on any malformed entry.
 */
export function parseAdmins(admins: string): Set<string> {
  const set = new Set<string>()
  for (const rawEntry of admins.split(',')) {
    const entry = rawEntry.trim()
    if (entry === '') throw new Error('web-auth: DSH_WEB_ADMINS holds an empty entry')
    if (!LOGIN_PATTERN.test(entry)) {
      throw new Error(`web-auth: admin login "${entry}" must match ${String(LOGIN_PATTERN)}`)
    }
    set.add(entry)
  }
  return set
}

/**
 * Read the managed user store. A missing file is the fresh-deployment state;
 * anything present must parse completely — a corrupt store is a loud failure,
 * never a silent fallback to the environment seed.
 * @param path - the store file (a dsh-home path).
 * @returns the stored records, or undefined when the file does not exist.
 * @throws when the file exists but does not match the format.
 */
export function readUserStore(path: string): StoredUser[] | undefined {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`web-auth: cannot read the user store "${path}" (${error instanceof Error ? error.message : String(error)})`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error: unknown) {
    throw new Error(`web-auth: the user store "${path}" is not valid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`web-auth: the user store "${path}" is not a user store document`)
  }
  const doc = parsed as { version?: unknown; users?: unknown }
  if (doc.version !== 1 || !Array.isArray(doc.users)) {
    throw new Error(`web-auth: the user store "${path}" is not a version-1 user store document`)
  }
  const seen = new Set<string>()
  return doc.users.map((entry: unknown): StoredUser => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`web-auth: the user store "${path}" holds a malformed user entry`)
    }
    const item = entry as Record<string, unknown>
    if (typeof item.login !== 'string' || typeof item.scryptHash !== 'string'
      || (item.role !== 'admin' && item.role !== 'user')
      || typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)) {
      throw new Error(`web-auth: the user store "${path}" holds a malformed user entry`)
    }
    if (!LOGIN_PATTERN.test(item.login)) {
      throw new Error(`web-auth: the user store "${path}" holds login "${item.login}" outside the login charset`)
    }
    if (seen.has(item.login)) {
      throw new Error(`web-auth: the user store "${path}" lists login "${item.login}" twice`)
    }
    seen.add(item.login)
    parseScrypt(item.scryptHash, `stored hash of "${item.login}"`)
    return { login: item.login, scryptHash: item.scryptHash, role: item.role, createdAt: item.createdAt }
  })
}

/** A login-page render request: no error, wrong credentials, or a brute-force pause. */
type LoginError = undefined | 'invalid' | 'paused'

/**
 * Render the Russian no-JS login page.
 * @param error - the banner to show, or none.
 * @returns the full HTML document.
 */
export function renderLoginPage(error: LoginError): string {
  const banner = error === undefined ? '' : error === 'invalid'
    ? '<p class="error" role="alert">Неверный логин или пароль.</p>'
    : '<p class="error" role="alert">Слишком много попыток входа. Подождите минуту.</p>'
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Вход — DSH</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  font: 16px/1.5 system-ui, sans-serif; background: #f5f5f5; color: #1a1a1a; }
@media (prefers-color-scheme: dark) { body { background: #141414; color: #eee; } }
.card { width: min(22rem, calc(100vw - 2rem)); padding: 2rem; background: #fff; border-radius: 10px;
  box-shadow: 0 4px 24px rgba(0,0,0,.12); }
@media (prefers-color-scheme: dark) { .card { background: #222; } }
h1 { margin: 0 0 1.5rem; font-size: 1.25rem; }
label { display: block; margin: .75rem 0 .25rem; font-size: .875rem; }
input { width: 100%; padding: .5rem .625rem; font: inherit; border: 1px solid #999; border-radius: 6px;
  background: transparent; color: inherit; }
button { margin-top: 1.25rem; width: 100%; padding: .625rem; font: inherit; border: 0; border-radius: 6px;
  background: #1a6dc0; color: #fff; cursor: pointer; }
.error { margin: 0 0 .25rem; padding: .5rem .625rem; border-radius: 6px; background: #c02929; color: #fff; }
</style>
</head>
<body>
<main class="card">
<h1>Вход в DSH</h1>${banner}
<form method="post" action="/login">
<label for="login">Логин</label>
<input id="login" name="login" autocomplete="username" required autofocus>
<label for="password">Пароль</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Войти</button>
</form>
</main>
</body>
</html>
`
}

/** Headers every login-flow response carries: no storage, no framing, no sniffing. */
const LOGIN_SECURITY_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; style-src 'unsafe-inline'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

/** The plain-body 401 the gate answers non-navigating unauthenticated requests with (instance-probe contract). */
const UNAUTHORIZED_BODY = 'unauthorized'

/** Normalized per-IP brute-force state. */
interface IpState { failures: number; pausedUntil: number }

/**
 * Extract the client IP the rate limiter counts by, with the node IPv6-mapped
 * prefix stripped. Behind a reverse proxy every client shares one bucket —
 * the counter protects against online guessing, not attribution.
 * @param req - the incoming request.
 * @returns the normalized remote address, or '?' when the socket is gone.
 */
export function normalizeClientIp(req: IncomingMessage): string {
  const raw = req.socket.remoteAddress ?? '?'
  return raw.startsWith('::ffff:') ? raw.slice('::ffff:'.length) : raw
}

/**
 * Whether an unauthenticated request is a browser navigation (redirect to the
 * login page) rather than an API call (plain 401). Browsers send
 * `Sec-Fetch-Dest: document` or `Accept: text/html`; fetch, curl, and the
 * startup probe do not.
 * @param req - the unauthenticated request.
 * @returns whether to answer with a redirect instead of a 401.
 */
export function isNavigationRequest(req: IncomingMessage): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  if (req.headers['sec-fetch-dest'] === 'document') return true
  return (req.headers.accept ?? '').includes('text/html')
}

/**
 * Extract the value of {@link SESSION_COOKIE} from a raw Cookie header.
 * @param cookie - the raw Cookie header value, or undefined when absent.
 * @returns the cookie value, or undefined when the header carries none.
 */
export function sessionCookieValue(cookie: string | undefined): string | undefined {
  if (cookie === undefined) return undefined
  for (const part of cookie.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${SESSION_COOKIE}=`)) return trimmed.slice(SESSION_COOKIE.length + 1)
  }
  return undefined
}

/** One Basic-authorization credential pair. */
interface BasicCredentials { login: string; password: string }

/**
 * Decode `Authorization: Basic …`.
 * @param req - the request possibly carrying Basic credentials.
 * @returns the pair, or undefined when the header is absent or malformed.
 */
function basicCredentials(req: IncomingMessage): BasicCredentials | undefined {
  const header = req.headers.authorization
  if (header === undefined || !header.startsWith('Basic ')) return undefined
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
  const at = decoded.indexOf(':')
  if (at <= 0) return undefined
  return { login: decoded.slice(0, at), password: decoded.slice(at + 1) }
}

/** Plugin config: composition-supplied deployment settings. */
export interface Config {
  /**
   * `DSH_WEB_USERS` — comma-separated `login:scrypt-hash`. The first-boot
   * seed of the managed store and its access-recovery source (an empty store
   * re-seeds from it); a store that holds users ignores it.
   */
  users?: string
  /** `DSH_WEB_ADMINS` — logins seeded with the `admin` role alongside `users`. */
  admins?: string
  /** File the managed user accounts persist to (a dsh-home path). */
  userStore: string
  /** File the server-side sessions persist to (a dsh-home path). */
  sessionStore: string
  /** Parent directory of the per-login cabinets (the workspace root). */
  workspaceRoot: string
  /** Session lifetime in days. */
  sessionTtlDays: number
  /**
   * `DSH_WEB_MAX_SESSIONS_PER_USER` — how many live sessions one login may
   * hold; a new login over the cap evicts that login's least recently seen
   * sessions until it fits.
   */
  maxSessionsPerUser: number
  /** Consecutive failed logins from one IP before the pause. */
  maxFailures: number
  /** Brute-force pause length in milliseconds. */
  pauseMs: number
}

export const Config: z<Config> = z.object({
  users: z.string(),
  admins: z.string(),
  userStore: z.string().required(),
  sessionStore: z.string().required(),
  workspaceRoot: z.string().required(),
  sessionTtlDays: z.natural().default(30),
  maxSessionsPerUser: z.natural().min(1).default(5),
  maxFailures: z.natural().default(5),
  pauseMs: z.natural().default(60_000),
})

/** Test seam: pure helpers the spec pins. */
export const internals = {
  parseScrypt,
  matchesRecord,
  LOGIN_PATTERN,
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
  PASSWORD_MIN,
  PASSWORD_MAX,
}

/** The live in-memory account record behind every check. */
interface ManagedUser {
  login: string
  record: ScryptRecord
  /** The raw stored hash; its sha256 is the session revision. */
  hash: string
  revision: string
  role: AdminRole
  createdAt: number
}

/**
 * Mount the login-password authentication: seat, routes, stores, identity
 * service, index marker.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  // --- User store: read, seed, or go passive -------------------------------
  const stored = readUserStore(config.userStore)
  const seedSource = config.users === undefined || config.users.trim() === '' ? undefined : config.users
  const users = new Map<string, ManagedUser>()
  if (stored !== undefined && stored.length > 0) {
    // The store owns the accounts; the environment is not a daily source.
    for (const entry of stored) {
      users.set(entry.login, {
        login: entry.login,
        record: parseScrypt(entry.scryptHash, `stored hash of "${entry.login}"`),
        hash: entry.scryptHash,
        revision: createHash('sha256').update(entry.scryptHash).digest('hex'),
        role: entry.role,
        createdAt: entry.createdAt,
      })
    }
  } else if (seedSource === undefined) {
    // Passive mode: no seat, no service, no marker — an open local server.
    return
  } else {
    // First boot or access recovery: seed from the environment once.
    const seeded = parseUsers(seedSource)
    const admins = config.admins === undefined || config.admins.trim() === '' ? new Set<string>() : parseAdmins(config.admins)
    const now = Date.now()
    for (const entry of seeded.values()) {
      users.set(entry.login, {
        login: entry.login,
        record: entry.record,
        hash: entry.hash,
        revision: entry.revision,
        role: admins.has(entry.login) ? 'admin' : 'user',
        createdAt: now,
      })
    }
  }

  /**
   * Persist the managed account table atomically (dsh-atomic-write) so a
   * crash mid-write can never truncate the live file.
   */
  const saveUsers = async (): Promise<void> => {
    const file: UserStoreFile = {
      version: 1,
      users: [...users.values()].map(user => ({
        login: user.login, scryptHash: user.hash, role: user.role, createdAt: user.createdAt,
      })),
    }
    await writeFileAtomic(config.userStore, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
  }
  if (stored === undefined || stored.length === 0) await saveUsers()

  // --- Session store -------------------------------------------------------
  const sessions = new Map<string, StoredSession>()
  try {
    const text = readFileSync(config.sessionStore, 'utf8')
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('not a session store document')
    }
    const doc = parsed as { version?: unknown; sessions?: unknown }
    if (doc.version === 1) {
      throw new Error('unsupported session store version 1 (the current format is 2)')
    }
    if (doc.version !== 2 || !Array.isArray(doc.sessions)) {
      throw new Error('not a session store document')
    }
    const now = Date.now()
    for (const entry of doc.sessions) {
      if (typeof entry !== 'object' || entry === null) {
        throw new Error('malformed session entry')
      }
      const item = entry as Record<string, unknown>
      if (typeof item.id !== 'string' || typeof item.login !== 'string'
        || typeof item.issuedAt !== 'number' || typeof item.expiresAt !== 'number' || typeof item.rev !== 'string'
        || typeof item.lastSeenAt !== 'number') {
        throw new Error('malformed session entry')
      }
      if (item.expiresAt > now && users.get(item.login)?.revision === item.rev) {
        sessions.set(item.id, {
          id: item.id, login: item.login, issuedAt: item.issuedAt,
          expiresAt: item.expiresAt, rev: item.rev, lastSeenAt: item.lastSeenAt,
        })
      }
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`web-auth: cannot read the session store "${config.sessionStore}" `
        + `(${error instanceof Error ? error.message : String(error)}); delete the file to force every user to log in again`)
    }
  }

  /**
   * Persist the session map atomically (tmp + rename) so a crash mid-write
   * can never truncate the live file.
   */
  const saveSessions = (): void => {
    const file: SessionStoreFile = { version: 2, sessions: [...sessions.values()] }
    mkdirSync(dirname(config.sessionStore), { recursive: true })
    const tmp = `${config.sessionStore}.tmp`
    writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`)
    renameSync(tmp, config.sessionStore)
  }

  /** When the last throttled `lastSeenAt` flush ran; boot counts as one. */
  let lastSeenFlushAt = Date.now()

  /**
   * Refresh one live session's `lastSeenAt`, flushing the store at most once
   * per {@link LAST_SEEN_FLUSH_MS}.
   * @param entry - the session that just authenticated a request.
   */
  function touchSession(entry: StoredSession): void {
    entry.lastSeenAt = Date.now()
    const now = Date.now()
    if (now - lastSeenFlushAt < LAST_SEEN_FLUSH_MS) return
    lastSeenFlushAt = now
    saveSessions()
  }

  // --- Cabinets ------------------------------------------------------------
  const cabinetRoots = new Map<string, string>()
  const workspaceEnsured = new Set<string>()

  /**
   * The canonical cabinet root of one login, creating the directory when
   * missing (first login, or a volume wipe while the session survived).
   * @param login - an authenticated user's login.
   * @returns the realpath'd cabinet root.
   */
  function cabinetRoot(login: string): string {
    const cached = cabinetRoots.get(login)
    if (cached !== undefined) return cached
    const target = join(config.workspaceRoot, login)
    mkdirSync(target, { recursive: true })
    const root = realpathSync(target)
    cabinetRoots.set(login, root)
    return root
  }

  /**
   * Register the cabinet as a workspace once per boot, so the sidebar lists
   * it right after login and after a restart. Best effort: a failure logs
   * and the user can still register the directory from the workspace dialog.
   * @param root - the canonical cabinet root.
   */
  function ensureCabinetWorkspace(root: string): void {
    if (workspaceEnsured.has(root)) return
    workspaceEnsured.add(root)
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined) return
    void (async () => {
      const existing = await registry.resolveByPath(root)
      if (existing === undefined) await registry.create(root)
    })().catch((error: unknown) => {
      ctx.logger.warn(`web-auth: cabinet workspace registration failed for "${root}": ${String(error)}`)
    })
  }

  // --- Brute-force fence ---------------------------------------------------
  const ipStates = new Map<string, IpState>()

  /**
   * Whether this IP is paused right now; an expired pause is dropped (the
   * next failure starts a fresh count), while a pure failure count is not.
   * @param ip - the normalized client address.
   * @returns the state when a pause is active, else undefined.
   */
  function activePause(ip: string): IpState | undefined {
    const state = ipStates.get(ip)
    if (state === undefined || state.pausedUntil === 0) return undefined
    if (state.pausedUntil <= Date.now()) {
      ipStates.delete(ip)
      return undefined
    }
    return state
  }

  /** Count one failed attempt; crossing the threshold starts the pause. */
  function recordFailure(ip: string): void {
    const state = ipStates.get(ip)
    if (state === undefined || (state.pausedUntil !== 0 && state.pausedUntil <= Date.now())) {
      ipStates.set(ip, { failures: 1, pausedUntil: 0 })
      return
    }
    state.failures += 1
    if (state.failures >= config.maxFailures) {
      state.pausedUntil = Date.now() + config.pauseMs
      state.failures = 0
    }
    ipStates.set(ip, state)
  }

  // --- Authentication core -------------------------------------------------
  const DUMMY = parseScrypt(
    `scrypt$${String(SCRYPT_N)}$${String(SCRYPT_R)}$${String(SCRYPT_P)}$${randomBytes(16).toString('hex')}$${randomBytes(SCRYPT_KEYLEN).toString('hex')}`,
    'dummy',
  )

  /**
   * Verify one credential pair against the user table, spending the same
   * scrypt work on unknown logins so timing cannot enumerate users.
   * @param login - the presented login.
   * @param password - the presented password.
   * @returns the login on success, or undefined.
   */
  function verify(login: string, password: string): string | undefined {
    const user = users.get(login)
    if (user === undefined) {
      matchesRecord(password, DUMMY)
      return undefined
    }
    return matchesRecord(password, user.record) ? login : undefined
  }

  /**
   * Mint a session for one login and persist immediately. When the login
   * already holds {@link Config.maxSessionsPerUser} sessions, its least
   * recently seen ones are evicted until the new one fits.
   * @param login - the verified login.
   * @returns the Set-Cookie header value.
   */
  function issueSession(login: string): string {
    const now = Date.now()
    const id = randomBytes(32).toString('hex')
    sessions.set(id, {
      id, login, issuedAt: now, expiresAt: now + config.sessionTtlDays * 86_400_000,
      rev: users.get(login)?.revision ?? '', lastSeenAt: now,
    })
    // Equal lastSeenAt keeps minting order (stable sort), so ties evict the older mint.
    const own = [...sessions.values()]
      .filter(entry => entry.login === login)
      .sort((a, b) => a.lastSeenAt - b.lastSeenAt)
    for (const evicted of own.slice(0, own.length - config.maxSessionsPerUser)) {
      sessions.delete(evicted.id)
    }
    saveSessions()
    return `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${String(config.sessionTtlDays * 86_400)}`
  }

  /**
   * The identity a session id authenticates right now (live, unexpired, and
   * minted under the current password revision).
   * @param id - the cookie's session id.
   * @returns the identity, or undefined.
   */
  function identityFor(id: string | undefined): { login: string; admin: boolean; root: string } | undefined {
    if (id === undefined) return undefined
    const entry = sessions.get(id)
    if (entry === undefined || entry.expiresAt <= Date.now()) return undefined
    const user = users.get(entry.login)
    if (user === undefined || user.revision !== entry.rev) return undefined
    touchSession(entry)
    const root = cabinetRoot(entry.login)
    ensureCabinetWorkspace(root)
    return { login: entry.login, admin: user.role === 'admin', root }
  }

  // --- Administration (the webAuth service's account/device face) ----------

  /**
   * The managed account, or the typed unknown-login rejection.
   * @param login - the named account.
   * @returns the record.
   * @throws WebAdminError `user-not-found`.
   */
  function requireUser(login: string): ManagedUser {
    const user = users.get(login)
    if (user === undefined) throw new WebAdminError('user-not-found', `пользователь «${login}» не найден`)
    return user
  }

  /**
   * Check a created or reset password against the store's bounds.
   * @param password - the candidate password.
   * @throws WebAdminError `invalid-input` outside the bounds.
   */
  function assertPassword(password: string): void {
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw new WebAdminError('invalid-input', `пароль должен содержать от ${String(PASSWORD_MIN)} до ${String(PASSWORD_MAX)} символов`)
    }
  }

  /**
   * Delete every session of one login, persisting the session store.
   * @param login - the account whose devices die now.
   * @returns how many sessions were revoked.
   */
  function revokeSessionsOf(login: string): number {
    let revoked = 0
    for (const [id, entry] of sessions) {
      if (entry.login === login) {
        sessions.delete(id)
        revoked += 1
      }
    }
    if (revoked > 0) saveSessions()
    return revoked
  }

  /**
   * Whether the named account is the only admin left. Deleting or demoting
   * it would leave the deployment without any administrator — the store
   * keeps the last admin, and recovery re-seeds only from an empty store.
   * @param user - the account about to lose admin power.
   * @returns whether the change must be refused.
   */
  function isLastAdmin(user: ManagedUser): boolean {
    if (user.role !== 'admin') return false
    for (const entry of users.values()) {
      if (entry.role === 'admin' && entry.login !== user.login) return false
    }
    return true
  }

  /** The `webAuth` service face: identity resolution plus account administration. */
  const service = {
    identityFromCookie: (cookie: string | undefined): WebIdentity | undefined =>
      identityFor(sessionCookieValue(cookie)),

    listUsers(): AdminUserView[] {
      return [...users.values()]
        .sort((a, b) => a.login.localeCompare(b.login))
        .map(user => ({ login: user.login, role: user.role, createdAt: user.createdAt }))
    },

    async createUser(input: WebCreateUserInput): Promise<void> {
      if (!LOGIN_PATTERN.test(input.login)) {
        throw new WebAdminError('invalid-input', `логин «${input.login}» не подходит: от 1 до 64 символов A-Z a-z 0-9 . _ -`)
      }
      if (users.has(input.login)) throw new WebAdminError('user-exists', `пользователь «${input.login}» уже существует`)
      assertPassword(input.password)
      const hash = hashPassword(input.password)
      users.set(input.login, {
        login: input.login,
        record: parseScrypt(hash, `created hash of "${input.login}"`),
        hash,
        revision: createHash('sha256').update(hash).digest('hex'),
        role: input.role,
        createdAt: Date.now(),
      })
      await saveUsers()
    },

    async deleteUser(login: string): Promise<void> {
      const user = requireUser(login)
      if (isLastAdmin(user)) {
        throw new WebAdminError('last-admin', 'нельзя удалить последнего администратора')
      }
      users.delete(login)
      cabinetRoots.delete(login)
      revokeSessionsOf(login)
      await saveUsers()
    },

    async resetPassword(login: string, newPassword: string): Promise<void> {
      const user = requireUser(login)
      assertPassword(newPassword)
      user.hash = hashPassword(newPassword)
      user.record = parseScrypt(user.hash, `reset hash of "${login}"`)
      user.revision = createHash('sha256').update(user.hash).digest('hex')
      revokeSessionsOf(login)
      await saveUsers()
    },

    async setRole(login: string, role: AdminRole): Promise<void> {
      const user = requireUser(login)
      if (user.role === role) return
      if (role === 'user' && isLastAdmin(user)) {
        throw new WebAdminError('last-admin', 'нельзя снять роль с последнего администратора')
      }
      user.role = role
      await saveUsers()
    },

    listDevices(login: string): AdminDeviceView[] {
      requireUser(login)
      const now = Date.now()
      return [...sessions.values()]
        .filter(entry => entry.login === login && entry.expiresAt > now)
        .sort((a, b) => a.issuedAt - b.issuedAt)
        .map(entry => ({
          sessionId: entry.id, issuedAt: entry.issuedAt, expiresAt: entry.expiresAt, lastSeenAt: entry.lastSeenAt,
        }))
    },

    // oxlint-disable-next-line typescript/require-await -- async keeps a typed refusal a rejected promise, not a synchronous throw
    async revokeDevice(login: string, sessionId: string): Promise<void> {
      requireUser(login)
      const entry = sessions.get(sessionId)
      if (entry === undefined || entry.login !== login) {
        throw new WebAdminError('device-not-found', `устройство «${sessionId}» не найдено среди сессий «${login}»`)
      }
      sessions.delete(sessionId)
      saveSessions()
    },

    // oxlint-disable-next-line typescript/require-await -- async keeps an unknown login a rejected promise, not a synchronous throw
    async revokeAllDevices(login: string): Promise<number> {
      requireUser(login)
      return revokeSessionsOf(login)
    },
  }
  ctx.provide('webAuth', service)

  // --- Routes ---------------------------------------------------------------
  const disposeLogin = ctx.webServer.register({
    kind: 'exact',
    path: '/login',
    handler: (req, res) => void handleLogin(req, res),
  })
  const disposeLogout = ctx.webServer.register({
    kind: 'exact',
    path: '/logout',
    handler: (req, res) => { handleLogout(req, res) },
  })
  ctx.effect(() => () => { disposeLogin(); disposeLogout() }, 'web-auth: routes')

  /**
   * Serve `/login`: the form, its POST target, and the method fence.
   * @param req - the login request.
   * @param res - the response writer.
   */
  async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = normalizeClientIp(req)
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (identityFor(sessionCookieValue(req.headers.cookie)) !== undefined) {
        res.writeHead(303, { location: '/' }).end()
        return
      }
      const paused = activePause(ip) !== undefined
      const html = renderLoginPage(paused ? 'paused' : new URL(req.url ?? '/', 'http://x').searchParams.get('error') === '1' ? 'invalid' : undefined)
      res.writeHead(200, { ...LOGIN_SECURITY_HEADERS, 'content-length': String(Buffer.byteLength(html)) })
      res.end(req.method === 'HEAD' ? undefined : html)
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'GET, HEAD, POST' }).end()
      return
    }
    const mediaType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
    if (mediaType !== 'application/x-www-form-urlencoded') {
      res.writeHead(415).end()
      return
    }
    const body = await readBody(req)
    if (body === undefined) {
      res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' }).end('request body too large')
      return
    }
    const form = new URLSearchParams(body)
    const login = form.get('login') ?? ''
    const password = form.get('password') ?? ''
    const complete = login !== '' && password !== ''
    const pause = activePause(ip)
    const verified = complete ? verify(login, password) : undefined
    if (verified === undefined) {
      if (pause !== undefined) {
        // The pause beat the form: report it instead of counting again.
        writePaused(res, pause)
        return
      }
      if (complete) recordFailure(ip)
      const nowPaused = activePause(ip)
      if (nowPaused !== undefined) {
        writePaused(res, nowPaused)
        return
      }
      res.writeHead(303, { location: '/login?error=1' }).end()
      return
    }
    ipStates.delete(ip)
    const root = cabinetRoot(verified)
    ensureCabinetWorkspace(root)
    res.writeHead(303, { location: '/', 'set-cookie': issueSession(verified) }).end()
  }

  /**
   * Answer a brute-force pause for the form flow: the Russian login page
   * with the pause banner under the 429 status.
   * @param res - the response writer.
   * @param state - the active pause.
   */
  function writePaused(res: ServerResponse, state: IpState): void {
    const seconds = Math.max(1, Math.ceil((state.pausedUntil - Date.now()) / 1000))
    const html = renderLoginPage('paused')
    res.writeHead(429, {
      'retry-after': String(seconds),
      ...LOGIN_SECURITY_HEADERS,
      'content-length': String(Buffer.byteLength(html)),
    }).end(html)
  }

  /**
   * Serve `/logout`: revoke the presented session and clear the cookie.
   * @param req - the logout request.
   * @param res - the response writer.
   */
  function handleLogout(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end()
      return
    }
    const id = sessionCookieValue(req.headers.cookie)
    if (id !== undefined && sessions.delete(id)) saveSessions()
    res.writeHead(303, { location: '/login', 'set-cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` }).end()
  }

  // --- The auth seat ---------------------------------------------------------
  const seat: WebAuth = {
    request: (req, res, url) => {
      const basic = basicCredentials(req)
      if (basic !== undefined) {
        const ip = normalizeClientIp(req)
        const pause = activePause(ip)
        if (pause !== undefined) {
          const seconds = Math.max(1, Math.ceil((pause.pausedUntil - Date.now()) / 1000))
          res.writeHead(429, { 'retry-after': String(seconds), 'content-type': 'text/plain; charset=utf-8' })
            .end(`too many failed logins; retry in ${String(seconds)}s`)
          return false
        }
        if (verify(basic.login, basic.password) !== undefined) return true
        recordFailure(ip)
        res.writeHead(401, { 'www-authenticate': 'Basic realm="dsh", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' })
          .end('unauthorized')
        return false
      }
      if (identityFor(sessionCookieValue(req.headers.cookie)) !== undefined) return true
      if (url.pathname === '/login' || url.pathname === '/logout') return true
      if (isNavigationRequest(req)) {
        res.writeHead(302, { location: '/login', 'cache-control': 'no-store' }).end()
        return false
      }
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(UNAUTHORIZED_BODY)
      return false
    },
    upgrade: (req) => {
      const basic = basicCredentials(req)
      if (basic !== undefined) return verify(basic.login, basic.password) !== undefined
      return identityFor(sessionCookieValue(req.headers.cookie)) !== undefined
    },
  }
  const disposeSeat = ctx.webServer.registerAuth(seat)
  ctx.effect(() => () => { disposeSeat() }, 'web-auth: seat')

  // The SPA footer turns its «Выйти» control on only when this marker ships.
  ctx.effect(() => ctx.webServer.tapIndex(html => html.replace('</head>', '<meta name="dsh-web-auth" content="on"></head>')), 'web-auth: index tap')
}

/**
 * Read one urlencoded body up to 16 KiB.
 * @param req - the request whose body to read.
 * @returns the decoded body, or undefined when it exceeds the limit.
 */
async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 16 * 1024) return undefined
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
