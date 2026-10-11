/**
 * REAL-composition coverage for the login-password plugin: a test-only
 * cordis.yml booted through the vendored Loader mounts the webserver and
 * web-auth rows together, and every assertion observes the user-visible
 * HTTP surface — the login form flow, the session cookie, Basic admission,
 * the brute-force pause, upgrade gating, the identity service, session
 * persistence across boots, and loud failure on a corrupt store.
 */

import { createHash, randomBytes, scryptSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as WebAuth from '../src/webauth.ts'

/** The cookie name the plugin mints (mirrored for the spec's cookie jar). */
const SESSION_COOKIE = 'dsh_web_session'

/** A scrypt hash in the stored format. */
function makeHash(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, 32)
  return `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** The fake workspace registry the cabinet registration talks to. */
function fakeRegistry(calls: { resolveByPath: string[]; create: string[] }): object {
  return {
    resolveByPath: async (path: string) => {
      calls.resolveByPath.push(path)
      return undefined
    },
    create: async (path: string) => {
      calls.create.push(path)
      return { id: path, path }
    },
  }
}

interface BootOptions {
  users?: string
  admins?: string
  sessionStore?: string
  workspaceRoot?: string
  pauseMs?: number
  registry?: object
}

/** What a booted composition hands back: the live context plus its endpoints. */
interface LoadedComposition {
  ctx: Context
  server: InstanceType<typeof HttpServer>
  port: number
  paths: { store: string; workspace: string }
}

/** Boot the webserver + web-auth composition through the real Loader. */
async function loadComposition(opts: BootOptions = {}): Promise<LoadedComposition> {
  root = await mkdtemp(join(tmpdir(), 'dsh-webauth-loader-'))
  const paths = { store: opts.sessionStore ?? join(root, 'home', 'web-sessions.json'), workspace: opts.workspaceRoot ?? join(root, 'workspace') }
  const configPath = join(root, 'cordis.yml')
  const rows = [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@deepseek-ai/dsh-web-app/webauth'",
    '  config:',
    `    users: ${JSON.stringify(opts.users ?? `bob:${makeHash('bob-pass')}`)}`,
    ...(opts.admins === undefined ? [] : [`    admins: ${JSON.stringify(opts.admins)}`]),
    `    sessionStore: ${JSON.stringify(paths.store)}`,
    `    workspaceRoot: ${JSON.stringify(paths.workspace)}`,
    ...(opts.pauseMs === undefined ? [] : [`    pauseMs: ${String(opts.pauseMs)}`]),
  ]
  await writeFile(configPath, `${rows.join('\n')}\n`)

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-web-app/webauth', WebAuth],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  if (opts.registry !== undefined) context.provide('workspaceRegistry', opts.registry as never)
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  const server = context.webServer
  return { ctx: context, server, port: server.port, paths }
}

/** One request against the running server, following redirects manually. */
async function request(port: number, path: string, init?: RequestInit): Promise<Response> {
  return await fetch(`http://127.0.0.1:${String(port)}${path}`, { redirect: 'manual', ...init })
}

/** POST the login form once. */
function loginPost(port: number, login: string, password: string, init?: RequestInit): Promise<Response> {
  return request(port, '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ login, password }).toString(),
    ...init,
  })
}

/** The session id inside the login response's Set-Cookie header. */
function cookieOf(response: Response): string {
  const set = response.headers.getSetCookie().find(value => value.startsWith(`${SESSION_COOKIE}=`))
  expect(set).toBeDefined()
  return set!.slice(`${SESSION_COOKIE}=`.length).split(';')[0]!
}

/** One raw upgrade request; resolves after the server's first response bytes. */
async function rawUpgrade(port: number, path: string, headers: string[] = []): Promise<string> {
  const socket = connect(port, '127.0.0.1')
  socket.on('error', () => { /* A gate denial closes the socket; that is the outcome. */ })
  await once(socket, 'connect')
  const response = once(socket, 'data')
  socket.write([
    `GET ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${String(port)}`,
    'Connection: Upgrade',
    'Upgrade: dsh-test',
    ...headers,
    '',
    '',
  ].join('\r\n'))
  const [data] = await response as [Buffer]
  socket.destroy()
  return String(data)
}

describe('webauth pure helpers', () => {
  it('parseUsers accepts a well-formed table and rejects every malformed shape', () => {
    const hash = makeHash('x')
    const table = WebAuth.parseUsers(`alice:${hash}, bob:${hash}`)
    expect([...table.records.keys()]).toEqual(['alice', 'bob'])
    expect(table.revisions.get('alice')).toBe(createHash('sha256').update(hash).digest('hex'))

    expect(() => WebAuth.parseUsers(`alice:${hash},`)).toThrow(/empty entry/)
    expect(() => WebAuth.parseUsers('justalogin')).toThrow(/not "login:hash"/)
    expect(() => WebAuth.parseUsers(':hash')).toThrow(/not "login:hash"/)
    expect(() => WebAuth.parseUsers('alice:')).toThrow(/not "login:hash"/)
    expect(() => WebAuth.parseUsers(`bad login:${hash}`)).toThrow(/must match/)
    expect(() => WebAuth.parseUsers(`../evil:${hash}`)).toThrow(/must match/)
    expect(() => WebAuth.parseUsers(`alice:${hash},alice:${hash}`)).toThrow(/twice/)
    expect(() => WebAuth.parseUsers('alice:notscrypt$1$1$1$aa$bb')).toThrow(/expected "scrypt/)
    expect(() => WebAuth.parseUsers('alice:scrypt$x$1$1$aa$bb')).toThrow(/positive integers/)
    expect(() => WebAuth.parseUsers('alice:scrypt$16$0$1$aa$bb')).toThrow(/positive integers/)
    expect(() => WebAuth.parseUsers('alice:scrypt$16$1$1$$bb')).toThrow(/empty salt or key/)
  })

  it('parseAdmins accepts a list and rejects malformed entries', () => {
    expect([...WebAuth.parseAdmins('alice, bob')]).toEqual(['alice', 'bob'])
    expect(() => WebAuth.parseAdmins('alice,')).toThrow(/empty entry/)
    expect(() => WebAuth.parseAdmins('bad/name')).toThrow(/must match/)
  })

  it('matchesRecord answers both verification arms', () => {
    const record = WebAuth.internals.parseScrypt(makeHash('pw'), 'test')
    expect(WebAuth.internals.matchesRecord('pw', record)).toBe(true)
    expect(WebAuth.internals.matchesRecord('no', record)).toBe(false)
  })

  it('renderLoginPage carries the Russian copy for each banner', () => {
    expect(WebAuth.renderLoginPage(undefined)).toContain('Вход в DSH')
    expect(WebAuth.renderLoginPage(undefined)).not.toContain('role="alert"')
    expect(WebAuth.renderLoginPage('invalid')).toContain('Неверный логин или пароль.')
    expect(WebAuth.renderLoginPage('paused')).toContain('Подождите минуту.')
  })

  it('normalizeClientIp strips the IPv6-mapped prefix and answers ? without a socket', () => {
    expect(WebAuth.normalizeClientIp({ socket: { remoteAddress: '::ffff:10.0.0.1' } } as never)).toBe('10.0.0.1')
    expect(WebAuth.normalizeClientIp({ socket: { remoteAddress: '127.0.0.1' } } as never)).toBe('127.0.0.1')
    expect(WebAuth.normalizeClientIp({ socket: {} } as never)).toBe('?')
  })

  it('isNavigationRequest branches on method, Sec-Fetch-Dest, and Accept', () => {
    expect(WebAuth.isNavigationRequest({ method: 'GET', headers: { 'sec-fetch-dest': 'document' } } as never)).toBe(true)
    expect(WebAuth.isNavigationRequest({ method: 'GET', headers: { accept: 'text/html,application/xhtml+xml' } } as never)).toBe(true)
    expect(WebAuth.isNavigationRequest({ method: 'POST', headers: { 'sec-fetch-dest': 'document' } } as never)).toBe(false)
    expect(WebAuth.isNavigationRequest({ method: 'GET', headers: { accept: '*/*' } } as never)).toBe(false)
  })

  it('sessionCookieValue finds the session cookie among its neighbors', () => {
    expect(WebAuth.sessionCookieValue(`a=1; ${SESSION_COOKIE}=abc; b=2`)).toBe('abc')
    expect(WebAuth.sessionCookieValue('a=1')).toBeUndefined()
    expect(WebAuth.sessionCookieValue(undefined)).toBeUndefined()
  })
})

describe('webauth real composition', () => {
  it('serves the login page, mints a session, and gates the app surface', { timeout: 60_000 }, async () => {
    const registryCalls = { resolveByPath: [] as string[], create: [] as string[] }
    const registry = fakeRegistry(registryCalls)
    const { ctx, server, port, paths } = await loadComposition({ registry })
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    server.registerUpgrade({
      path: '/events',
      handler: (_req, socket) => { socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: dsh-test\r\n\r\n') },
    })
    server.registerFallback((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(server.applyIndexTaps('<head></head><body>shell</body>'))
    })

    // Unauthenticated: navigation redirects to the login page; API calls get
    // the plain 401 body; the login page itself is public.
    const navigation = await request(port, '/', { headers: { 'sec-fetch-dest': 'document', accept: 'text/html' } })
    expect(navigation.status).toBe(302)
    expect(navigation.headers.get('location')).toBe('/login')
    const api = await request(port, '/api/anything')
    expect(api.status).toBe(401)
    expect(await api.text()).toBe('unauthorized')
    const form = await request(port, '/login')
    expect(form.status).toBe(200)
    const formBody = await form.text()
    expect(formBody).toContain('Вход в DSH')
    expect(form.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(form.headers.get('cache-control')).toBe('no-store')

    // The login form's method fence and media-type fence.
    expect((await request(port, '/login', { method: 'PUT' })).status).toBe(405)
    expect((await loginPost(port, 'bob', 'bob-pass', { headers: { 'content-type': 'text/plain' } })).status).toBe(415)

    // Wrong password bounces back to the form with the error banner; HEAD
    // serves the page's headers alone.
    const wrong = await loginPost(port, 'bob', 'nope')
    expect(wrong.status).toBe(303)
    expect(wrong.headers.get('location')).toBe('/login?error=1')
    const withError = await request(port, '/login?error=1')
    expect(await withError.text()).toContain('Неверный логин или пароль.')
    const head = await request(port, '/login', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')

    // Correct login: cookie minted, cabinet created, workspace registered,
    // and the whole app surface reachable under the session cookie.
    const good = await loginPost(port, 'bob', 'bob-pass')
    expect(good.status).toBe(303)
    expect(good.headers.get('location')).toBe('/')
    const cookie = cookieOf(good)
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }))
      .resolves.toMatchObject({ status: 200 })
    const shell = await request(port, '/', { headers: { cookie: `${SESSION_COOKIE}=${cookie}`, accept: 'text/html', 'sec-fetch-dest': 'document' } })
    expect(await shell.text()).toContain('<meta name="dsh-web-auth" content="on">')
    // The cabinet directory exists under the workspace root and was
    // registered as a workspace once.
    const { realpathSync } = await import('node:fs')
    const cabinet = realpathSync(join(paths.workspace, 'bob'))
    expect(registryCalls.create).toEqual([cabinet])

    // One login = one session: re-login revokes the first cookie.
    const second = await loginPost(port, 'bob', 'bob-pass')
    const secondCookie = cookieOf(second)
    expect(secondCookie).not.toBe(cookie)
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }))
      .resolves.toMatchObject({ status: 401 })
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${secondCookie}` } }))
      .resolves.toMatchObject({ status: 200 })

    // Identity service: the cookie resolves to the scoped identity, with the
    // cabinet root as canonical path; garbage does not.
    const identity = ctx.get('webAuth')?.identityFromCookie(`${SESSION_COOKIE}=${secondCookie}`)
    expect(identity?.login).toBe('bob')
    expect(identity?.admin).toBe(false)
    expect(typeof identity?.root).toBe('string')
    expect(ctx.get('webAuth')?.identityFromCookie(`${SESSION_COOKIE}=deadbeef`)).toBeUndefined()
    expect(ctx.get('webAuth')?.identityFromCookie(undefined)).toBeUndefined()

    // Logout revokes the session and clears the cookie; its method fence holds.
    const loggedOut = await request(port, '/logout', { method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${secondCookie}` } })
    expect(loggedOut.status).toBe(303)
    expect(loggedOut.headers.get('location')).toBe('/login')
    expect(loggedOut.headers.getSetCookie()[0]).toContain('Max-Age=0')
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${secondCookie}` } }))
      .resolves.toMatchObject({ status: 401 })
    expect((await request(port, '/logout')).status).toBe(405)

    // Upgrades: no cookie is denied at the socket, a live session passes.
    expect(await rawUpgrade(port, '/events')).toContain('401 Unauthorized')
    const authed = await loginPost(port, 'bob', 'bob-pass')
    expect(await rawUpgrade(port, '/events', [`Cookie: ${SESSION_COOKIE}=${cookieOf(authed)}`])).toContain('101 Switching Protocols')
  })

  it('admits Basic credentials, counts their failures into the same pause, and ignores malformed headers', { timeout: 60_000 }, async () => {
    const { server, port } = await loadComposition({ pauseMs: 200 })
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    server.registerUpgrade({
      path: '/events',
      handler: (_req, socket) => { socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: dsh-test\r\n\r\n') },
    })

    const good = Buffer.from('bob:bob-pass').toString('base64')
    const bad = Buffer.from('bob:nope').toString('base64')
    const authed = await request(port, '/probe', { headers: { authorization: `Basic ${good}` } })
    expect(authed.status).toBe(200)

    // Wrong Basic credentials answer 401 with the challenge header.
    const denied = await request(port, '/probe', { headers: { authorization: `Basic ${bad}` } })
    expect(denied.status).toBe(401)
    expect(denied.headers.get('www-authenticate')).toBe('Basic realm="dsh", charset="UTF-8"')

    // A malformed Basic header is no credential at all: plain 401, no challenge.
    const garbage = await request(port, '/probe', { headers: { authorization: `Basic ${Buffer.from('nocolon').toString('base64')}` } })
    expect(garbage.status).toBe(401)
    expect(garbage.headers.get('www-authenticate')).toBeNull()
    const undecodable = await request(port, '/probe', { headers: { authorization: 'Basic !!!' } })
    expect(undecodable.status).toBe(401)
    expect(undecodable.headers.get('www-authenticate')).toBeNull()

    // Basic admissions pass the upgrade gate too; failures of either kind
    // share one per-IP bucket until the pause trips.
    expect(await rawUpgrade(port, '/events', [`Authorization: Basic ${good}`])).toContain('101 Switching Protocols')
    for (let attempt = 0; attempt < 4; attempt++) await request(port, '/probe', { headers: { authorization: `Basic ${bad}` } })
    const paused = await request(port, '/probe', { headers: { authorization: `Basic ${good}` } })
    expect(paused.status).toBe(429)
    expect(paused.headers.get('retry-after')).toMatch(/^\d+$/)
    // After the (short) pause the bucket resets and the good pair works again.
    await new Promise(resolve => setTimeout(resolve, 250))
    await expect(request(port, '/probe', { headers: { authorization: `Basic ${good}` } })).resolves.toMatchObject({ status: 200 })
  })

  it('pauses the form flow after the configured failures and recovers', { timeout: 60_000 }, async () => {
    const { server, port } = await loadComposition({ pauseMs: 200 })
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })

    // Four failures bounce; the fifth trips the pause with the Russian page.
    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(loginPost(port, 'bob', 'nope')).resolves.toMatchObject({ status: 303 })
    }
    const fifth = await loginPost(port, 'bob', 'nope')
    expect(fifth.status).toBe(429)
    expect(fifth.headers.get('retry-after')).toMatch(/^\d+$/)
    expect(await fifth.text()).toContain('Подождите минуту.')
    // While paused, another form POST answers the pause instead of counting.
    await expect(loginPost(port, 'bob', 'nope')).resolves.toMatchObject({ status: 429 })
    // A success below the threshold clears the counter.
    await new Promise(resolve => setTimeout(resolve, 250))
    await expect(loginPost(port, 'bob', 'nope')).resolves.toMatchObject({ status: 303 })
    await expect(loginPost(port, 'bob', 'bob-pass')).resolves.toMatchObject({ status: 303 })
    await expect(loginPost(port, 'bob', 'nope')).resolves.toMatchObject({ status: 303 })
  })

  it('keeps sessions across restarts, revokes them on a password change, and refuses oversized bodies', { timeout: 60_000 }, async () => {
    const usersBob = `bob:${makeHash('bob-pass')}`
    const { ctx, server, port, paths } = await loadComposition({ users: usersBob })
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    const first = await loginPost(port, 'bob', 'bob-pass')
    const cookie = cookieOf(first)
    const store = await import('node:fs/promises').then(fs => fs.readFile(paths.store, 'utf8'))
    const doc = JSON.parse(store) as { sessions: unknown[] }
    expect(doc.sessions).toHaveLength(1)

    // Restart on the same users table and store: the cookie still admits.
    await ctx.fiber.dispose()
    const rebooted = await loadComposition({ users: usersBob, sessionStore: paths.store, workspaceRoot: paths.workspace })
    rebooted.server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    await expect(request(rebooted.port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }))
      .resolves.toMatchObject({ status: 200 })

    // A login removed from the user table invalidates its sessions.
    const removed = cookieOf(await loginPost(rebooted.port, 'bob', 'bob-pass'))
    await rebooted.ctx.fiber.dispose()
    const withoutBob = await loadComposition({
      users: `alice:${makeHash('alice-pass')}`,
      sessionStore: paths.store,
      workspaceRoot: paths.workspace,
    })
    withoutBob.server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    await expect(request(withoutBob.port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${removed}` } }))
      .resolves.toMatchObject({ status: 401 })

    // A changed password hash (new revision) invalidates the old session,
    // while the new password logs in.
    await withoutBob.ctx.fiber.dispose()
    const rotated = await loadComposition({
      users: `bob:${makeHash('bob-pass-2')}`,
      sessionStore: paths.store,
      workspaceRoot: paths.workspace,
    })
    rotated.server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    await expect(request(rotated.port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${removed}` } }))
      .resolves.toMatchObject({ status: 401 })
    await expect(loginPost(rotated.port, 'bob', 'bob-pass-2')).resolves.toMatchObject({ status: 303 })

    // An expired session is refused even though the store loaded it.
    const expiredCookie = cookieOf(await loginPost(rotated.port, 'bob', 'bob-pass-2'))
    await rotated.ctx.fiber.dispose()
    const expiredDoc = { version: 1, sessions: [{ id: expiredCookie, login: 'bob', issuedAt: Date.now() - 2000, expiresAt: Date.now() - 1000, rev: createHash('sha256').update(makeHash('unused')).digest('hex') }] }
    await import('node:fs/promises').then(fs => fs.writeFile(paths.store, JSON.stringify(expiredDoc)))
    const expiredBoot = await loadComposition({
      users: `bob:${makeHash('bob-pass')}`,
      sessionStore: paths.store,
      workspaceRoot: paths.workspace,
    })
    expiredBoot.server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    await expect(request(expiredBoot.port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${expiredCookie}` } }))
      .resolves.toMatchObject({ status: 401 })

    // A body over the 16 KiB form limit is refused, not parsed.
    const oversized = await loginPost(expiredBoot.port, 'bob', 'x'.repeat(17 * 1024))
    expect(oversized.status).toBe(413)

    // Missing fields bounce to the error banner (the form is required-attr
    // guarded; a bare POST still gets a definite answer).
    expect((await loginPost(expiredBoot.port, '', '')).status).toBe(303)
  })

  it('stays passive without users, and fails loud on a corrupt session store', { timeout: 60_000 }, async () => {
    const passive = await loadComposition({ users: '' })
    passive.server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    const open = await request(passive.port, '/probe')
    expect(open.status).toBe(200)
    await expect(open.text()).resolves.toBe('EXACT')
    expect(passive.server.applyIndexTaps('<head></head>')).toBe('<head></head>')
    await passive.ctx.fiber.dispose()

    await import('node:fs/promises').then(fs => fs.writeFile(join(root!, 'corrupt.json'), '{oops'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(loadComposition({ sessionStore: join(root!, 'corrupt.json') })).rejects.toThrow(/cannot read the session store/)
    warn.mockRestore()
  })

  it('marks admins in the identity and creates the cabinet under the workspace root', { timeout: 60_000 }, async () => {
    const { ctx, port, paths } = await loadComposition({ admins: 'bob' })
    const admin = await loginPost(port, 'bob', 'bob-pass')
    const cookie = cookieOf(admin)
    const identity = ctx.get('webAuth')?.identityFromCookie(`${SESSION_COOKIE}=${cookie}`)
    expect(identity).toMatchObject({ login: 'bob', admin: true })
    const { realpathSync } = await import('node:fs')
    expect(identity?.root).toBe(realpathSync(join(paths.workspace, 'bob')))
  })
})
