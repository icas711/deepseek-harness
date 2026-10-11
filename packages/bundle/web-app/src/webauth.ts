/**
 * Login-password authentication for the Web composition: the webserver auth
 * seat, the `/login` and `/logout` routes, scrypt user hashes from
 * `DSH_WEB_USERS`, persistent server-side sessions (one per login, 30 days,
 * surviving restarts), a per-IP brute-force pause, HTTP Basic for
 * non-interactive clients, and the `webAuth` identity service the API
 * gateway scopes session and workspace visibility by. Composed only through
 * the bundle patch; with no `users` config the plugin is passive (open
 * server, no identity service, no logout control).
 * @module @deepseek-ai/dsh-web-app/webauth
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { WebAuth } from '@deepseek-ai/dsh-host-webserver'
import type { WebIdentity } from '@deepseek-ai/dsh-host-apiproxy/web-identity'
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
}

/** On-disk shape of the session store. */
interface SessionStoreFile {
  version: 1
  sessions: StoredSession[]
}

/** Login-charset: names double as cabinet directory names, so they are plain segments. */
const LOGIN_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

/** scrypt parameters baked into every stored hash; the format owns them, not config. */
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32

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

/** Verified user table: login → parsed hash record plus the original string (the session revision source). */
interface UserTable {
  /** Parsed records keyed by login. */
  records: Map<string, ScryptRecord>
  /** sha256 of the raw hash string keyed by login; password change ⇒ revision change ⇒ sessions die. */
  revisions: Map<string, string>
}

/**
 * Parse `DSH_WEB_USERS` value: comma-separated `login:hash` pairs.
 * @param users - the raw config value (non-blank).
 * @returns the verified table.
 * @throws on any malformed entry or duplicate login.
 */
export function parseUsers(users: string): UserTable {
  const records = new Map<string, ScryptRecord>()
  const revisions = new Map<string, string>()
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
    if (records.has(login)) throw new Error(`web-auth: DSH_WEB_USERS lists login "${login}" twice`)
    records.set(login, parseScrypt(hash, `hash of "${login}"`))
    revisions.set(login, createHash('sha256').update(hash).digest('hex'))
  }
  return { records, revisions }
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
  'content-security-policy': 'default-src \'none\'; form-action \'self\'; frame-ancestors \'none\'; style-src \'unsafe-inline\'',
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
   * `DSH_WEB_USERS` — comma-separated `login:scrypt-hash`. Absent or blank
   * leaves the server open (the passive mode of local runs).
   */
  users?: string
  /** `DSH_WEB_ADMINS` — comma-separated logins that see every cabinet. */
  admins?: string
  /** File the server-side sessions persist to (a dsh-home path). */
  sessionStore: string
  /** Parent directory of the per-login cabinets (the workspace root). */
  workspaceRoot: string
  /** Session lifetime in days. */
  sessionTtlDays: number
  /** Consecutive failed logins from one IP before the pause. */
  maxFailures: number
  /** Brute-force pause length in milliseconds. */
  pauseMs: number
}

export const Config: z<Config> = z.object({
  users: z.string(),
  admins: z.string(),
  sessionStore: z.string().required(),
  workspaceRoot: z.string().required(),
  sessionTtlDays: z.natural().default(30),
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
}

/**
 * Mount the login-password authentication: seat, routes, session store,
 * identity service, index marker.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.users === undefined || config.users.trim() === '') {
    // Passive mode: no seat, no service, no marker — an open local server.
    return
  }
  const users = parseUsers(config.users)
  const admins = config.admins === undefined || config.admins.trim() === '' ? new Set<string>() : parseAdmins(config.admins)

  // --- Session store -------------------------------------------------------
  const sessions = new Map<string, StoredSession>()
  try {
    const text = readFileSync(config.sessionStore, 'utf8')
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('not a session store document')
    }
    const doc = parsed as { version?: unknown; sessions?: unknown }
    if (doc.version !== 1 || !Array.isArray(doc.sessions)) {
      throw new Error('not a session store document')
    }
    const now = Date.now()
    for (const entry of doc.sessions) {
      if (typeof entry !== 'object' || entry === null) {
        throw new Error('malformed session entry')
      }
      const item = entry as Record<string, unknown>
      if (typeof item.id !== 'string' || typeof item.login !== 'string'
        || typeof item.issuedAt !== 'number' || typeof item.expiresAt !== 'number' || typeof item.rev !== 'string') {
        throw new Error('malformed session entry')
      }
      if (item.expiresAt > now && users.records.has(item.login) && users.revisions.get(item.login) === item.rev) {
        sessions.set(item.id, { id: item.id, login: item.login, issuedAt: item.issuedAt, expiresAt: item.expiresAt, rev: item.rev })
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
    const file: SessionStoreFile = { version: 1, sessions: [...sessions.values()] }
    mkdirSync(dirname(config.sessionStore), { recursive: true })
    const tmp = `${config.sessionStore}.tmp`
    writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`)
    renameSync(tmp, config.sessionStore)
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
    const record = users.records.get(login)
    if (record === undefined) {
      matchesRecord(password, DUMMY)
      return undefined
    }
    return matchesRecord(password, record) ? login : undefined
  }

  /**
   * Mint a session for one login, replacing that user's previous session
   * (one login = one session) and persisting.
   * @param login - the verified login.
   * @returns the Set-Cookie header value.
   */
  function issueSession(login: string): string {
    const now = Date.now()
    for (const [id, entry] of sessions) {
      if (entry.login === login) sessions.delete(id)
    }
    const id = randomBytes(32).toString('hex')
    sessions.set(id, { id, login, issuedAt: now, expiresAt: now + config.sessionTtlDays * 86_400_000, rev: users.revisions.get(login) ?? '' })
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
    if (users.records.get(entry.login) === undefined) return undefined
    if (users.revisions.get(entry.login) !== entry.rev) return undefined
    const root = cabinetRoot(entry.login)
    ensureCabinetWorkspace(root)
    return { login: entry.login, admin: admins.has(entry.login), root }
  }

  /**
   * The `webAuth` service face: cookie → identity for the API gateway's
   * scoping points (see `dsh-host-apiproxy/web-identity`).
   */
  const service: { identityFromCookie(cookie: string | undefined): WebIdentity | undefined } = {
    identityFromCookie: cookie => identityFor(sessionCookieValue(cookie)),
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
