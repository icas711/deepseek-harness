/**
 * REAL-composition coverage for the login-password plugin: a test-only
 * cordis.yml booted through the vendored Loader mounts the webserver and
 * web-auth rows together, and every assertion observes the user-visible
 * HTTP surface or the `webAuth` service — the login form flow, the session
 * cookie, Basic admission, the brute-force pause, upgrade gating, the
 * managed user store (env seed on first boot, store ownership afterwards,
 * passive mode, loud corruption failure), session persistence across boots,
 * and the account/device administration face.
 */

import { createHash, randomBytes, scryptSync } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
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
  userStore?: string
  userStoreContent?: string
  sessionStore?: string
  workspaceRoot?: string
  pauseMs?: number
  maxSessionsPerUser?: number
  registry?: object
}

/** What a booted composition hands back: the live context plus its endpoints. */
interface LoadedComposition {
  ctx: Context
  server: InstanceType<typeof HttpServer>
  port: number
  paths: { userStore: string; store: string; workspace: string }
}

/** Boot the webserver + web-auth composition through the real Loader. */
async function loadComposition(opts: BootOptions = {}): Promise<LoadedComposition> {
  root = await mkdtemp(join(tmpdir(), 'dsh-webauth-loader-'))
  const paths = {
    userStore: opts.userStore ?? join(root, 'home', 'web-users.json'),
    store: opts.sessionStore ?? join(root, 'home', 'web-sessions.json'),
    workspace: opts.workspaceRoot ?? join(root, 'workspace'),
  }
  if (opts.userStoreContent !== undefined) {
    await mkdir(dirname(paths.userStore), { recursive: true })
    await writeFile(paths.userStore, opts.userStoreContent)
  }
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
    `    userStore: ${JSON.stringify(paths.userStore)}`,
    `    sessionStore: ${JSON.stringify(paths.store)}`,
    `    workspaceRoot: ${JSON.stringify(paths.workspace)}`,
    ...(opts.pauseMs === undefined ? [] : [`    pauseMs: ${String(opts.pauseMs)}`]),
    ...(opts.maxSessionsPerUser === undefined ? [] : [`    maxSessionsPerUser: ${String(opts.maxSessionsPerUser)}`]),
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

/** The stored user records of one user store file. */
async function storedUsers(path: string): Promise<{ login: string; role: string; createdAt: number }[]> {
  const text = await import('node:fs/promises').then(fs => fs.readFile(path, 'utf8'))
  return (JSON.parse(text) as { users: { login: string; role: string; createdAt: number }[] }).users
}

describe('webauth pure helpers', () => {
  it('parseUsers accepts a well-formed table and rejects every malformed shape', () => {
    const hash = makeHash('x')
    const table = WebAuth.parseUsers(`alice:${hash}, bob:${hash}`)
    expect([...table.keys()]).toEqual(['alice', 'bob'])
    expect(table.get('alice')?.hash).toBe(hash)
    expect(table.get('alice')?.revision).toBe(createHash('sha256').update(hash).digest('hex'))

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

  it('hashPassword mints a stored-format hash that verifies the password', () => {
    const hash = WebAuth.hashPassword('parol-12')
    const record = WebAuth.internals.parseScrypt(hash, 'test')
    expect(WebAuth.internals.matchesRecord('parol-12', record)).toBe(true)
    expect(WebAuth.internals.matchesRecord('drugoj-12', record)).toBe(false)
  })

  it('readUserStore accepts the version-1 document and refuses every malformed shape', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-webauth-store-'))
    try {
      const path = join(base, 'web-users.json')
      expect(WebAuth.readUserStore(path)).toBeUndefined()
      const good = {
        version: 1,
        users: [{ login: 'bob', scryptHash: makeHash('pw'), role: 'admin', createdAt: 5 }],
      }
      await writeFile(path, JSON.stringify(good))
      expect(WebAuth.readUserStore(path)).toEqual(good.users)
      for (const [label, content, message] of [
        ['not json', '{oops', /not valid JSON/],
        ['not an object', 'null', /not a user store document/],
        ['an array root', '[]', /not a version-1 user store document/],
        ['wrong version', JSON.stringify({ version: 2, users: [] }), /not a version-1 user store document/],
        ['users not an array', JSON.stringify({ version: 1, users: {} }), /not a version-1 user store document/],
        [
          'malformed entry',
          JSON.stringify({ version: 1, users: [{ login: 'bob', role: 'admin', createdAt: 5 }] }),
          /malformed user entry/,
        ],
        [
          'bad role',
          JSON.stringify({ version: 1, users: [{ login: 'bob', scryptHash: 'x', role: 'root', createdAt: 5 }] }),
          /malformed user entry/,
        ],
        [
          'bad login charset',
          JSON.stringify({ version: 1, users: [{ login: '../evil', scryptHash: 'x', role: 'user', createdAt: 5 }] }),
          /outside the login charset/,
        ],
        [
          'duplicate login',
          JSON.stringify({
            version: 1,
            users: [
              { login: 'bob', scryptHash: makeHash('pw'), role: 'user', createdAt: 5 },
              { login: 'bob', scryptHash: makeHash('pw2'), role: 'user', createdAt: 6 },
            ],
          }),
          /twice/,
        ],
        [
          'broken hash',
          JSON.stringify({ version: 1, users: [{ login: 'bob', scryptHash: 'nope', role: 'user', createdAt: 5 }] }),
          /expected "scrypt/,
        ],
      ] as const) {
        await writeFile(path, content)
        expect(() => WebAuth.readUserStore(path), label).toThrow(message)
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
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

    // The first boot seeded the managed store from the environment: the
    // seeded account is a plain user with a creation timestamp.
    const seeded = await storedUsers(paths.userStore)
    expect(seeded).toHaveLength(1)
    expect(seeded[0]).toMatchObject({ login: 'bob', role: 'user' })
    expect(seeded[0]!.createdAt).toBeGreaterThan(0)

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

    // Identity service: the cookie resolves to the scoped identity, with the
    // cabinet root as canonical path; garbage does not.
    const identity = ctx.get('webAuth')?.identityFromCookie(`${SESSION_COOKIE}=${cookie}`)
    expect(identity?.login).toBe('bob')
    expect(identity?.admin).toBe(false)
    expect(typeof identity?.root).toBe('string')
    expect(ctx.get('webAuth')?.identityFromCookie(`${SESSION_COOKIE}=deadbeef`)).toBeUndefined()
    expect(ctx.get('webAuth')?.identityFromCookie(undefined)).toBeUndefined()

    // Logout revokes the session and clears the cookie; its method fence holds.
    const loggedOut = await request(port, '/logout', { method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${cookie}` } })
    expect(loggedOut.status).toBe(303)
    expect(loggedOut.headers.get('location')).toBe('/login')
    expect(loggedOut.headers.getSetCookie()[0]).toContain('Max-Age=0')
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }))
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

  it('keeps sessions across restarts, and the store — not the environment — owns the accounts', { timeout: 60_000 }, async () => {
    const usersBob = `bob:${makeHash('bob-pass')}`
    const { ctx, server, port, paths } = await loadComposition({ users: usersBob })
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    const first = await loginPost(port, 'bob', 'bob-pass')
    const cookie = cookieOf(first)
    const store = await import('node:fs/promises').then(fs => fs.readFile(paths.store, 'utf8'))
    const doc = JSON.parse(store) as { sessions: unknown[] }
    expect(doc.sessions).toHaveLength(1)

    // Restart on the same managed store (the environment stays as it was):
    // the cookie still admits.
    await ctx.fiber.dispose()
    const rebooted = await loadComposition({
      users: usersBob,
      userStore: paths.userStore,
      sessionStore: paths.store,
      workspaceRoot: paths.workspace,
    })
    rebooted.server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    await expect(request(rebooted.port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }))
      .resolves.toMatchObject({ status: 200 })

    // The store owns the accounts: an environment naming a different login
    // changes nothing — bob still logs in, and alice was never created.
    await rebooted.ctx.fiber.dispose()
    const renamed = await loadComposition({
      users: `alice:${makeHash('alice-pass')}`,
      userStore: paths.userStore,
      sessionStore: paths.store,
      workspaceRoot: paths.workspace,
    })
    renamed.server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    await expect(loginPost(renamed.port, 'bob', 'bob-pass')).resolves.toMatchObject({ status: 303 })
    const stranger = await loginPost(renamed.port, 'alice', 'alice-pass')
    expect(stranger.status).toBe(303)
    expect(stranger.headers.get('location')).toBe('/login?error=1')
    expect((await storedUsers(paths.userStore)).map(user => user.login)).toEqual(['bob'])

    // An expired session is refused even though the store loaded it.
    const expiredCookie = cookieOf(await loginPost(renamed.port, 'bob', 'bob-pass'))
    await renamed.ctx.fiber.dispose()
    const expiredDoc = { version: 2, sessions: [{ id: expiredCookie, login: 'bob', issuedAt: Date.now() - 2000, expiresAt: Date.now() - 1000, rev: createHash('sha256').update(makeHash('unused')).digest('hex'), lastSeenAt: Date.now() - 1500 }] }
    await import('node:fs/promises').then(fs => fs.writeFile(paths.store, JSON.stringify(expiredDoc)))
    const expiredBoot = await loadComposition({
      users: usersBob,
      userStore: paths.userStore,
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

  it('stays passive on a blank environment with a missing or empty store, and fails loud on corrupt stores', { timeout: 60_000 }, async () => {
    const passive = await loadComposition({ users: '' })
    passive.server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    const open = await request(passive.port, '/probe')
    expect(open.status).toBe(200)
    await expect(open.text()).resolves.toBe('EXACT')
    expect(passive.server.applyIndexTaps('<head></head>')).toBe('<head></head>')
    expect(passive.ctx.get('webAuth')).toBeUndefined()
    await passive.ctx.fiber.dispose()

    // An existing-but-empty store with a blank environment is passive too.
    const empty = await loadComposition({ users: '', userStoreContent: JSON.stringify({ version: 1, users: [] }) })
    empty.server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    expect(await request(empty.port, '/probe')).toMatchObject({ status: 200 })
    expect(empty.ctx.get('webAuth')).toBeUndefined()
    await empty.ctx.fiber.dispose()

    // The same empty store plus a non-blank environment is the access-
    // recovery path: the store re-seeds from the environment.
    const recovered = await loadComposition({
      users: `bob:${makeHash('bob-pass')}`,
      admins: 'bob',
      userStore: empty.paths.userStore,
    })
    const identity = recovered.ctx.get('webAuth')
    expect(identity).toBeDefined()
    expect((await storedUsers(recovered.paths.userStore)).map(user => [user.login, user.role]))
      .toEqual([['bob', 'admin']])
    await recovered.ctx.fiber.dispose()

    // A corrupt user store is a loud boot failure, never a silent re-seed.
    await import('node:fs/promises').then(fs => fs.writeFile(join(root!, 'corrupt-users.json'), '{oops'))
    await expect(loadComposition({ userStore: join(root!, 'corrupt-users.json') }))
      .rejects.toThrow(/not valid JSON/)

    // A corrupt session store stays a loud boot failure too.
    await import('node:fs/promises').then(fs => fs.writeFile(join(root!, 'corrupt.json'), '{oops'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(loadComposition({ sessionStore: join(root!, 'corrupt.json') })).rejects.toThrow(/cannot read the session store/)
    warn.mockRestore()
  })

  it('seeds the admin role from DSH_WEB_ADMINS and keeps it in the store', { timeout: 60_000 }, async () => {
    const { ctx, port, paths } = await loadComposition({ admins: 'bob' })
    const admin = await loginPost(port, 'bob', 'bob-pass')
    const cookie = cookieOf(admin)
    const identity = ctx.get('webAuth')?.identityFromCookie(`${SESSION_COOKIE}=${cookie}`)
    expect(identity).toMatchObject({ login: 'bob', admin: true })
    const { realpathSync } = await import('node:fs')
    expect(identity?.root).toBe(realpathSync(join(paths.workspace, 'bob')))
    expect((await storedUsers(paths.userStore))[0]).toMatchObject({ login: 'bob', role: 'admin' })
  })
})

describe('webauth sessions per login', () => {
  it('keeps the first session alive across a second login and persists the version-2 store', { timeout: 60_000 }, async () => {
    const { server, port, paths } = await loadComposition()
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    const first = cookieOf(await loginPost(port, 'bob', 'bob-pass'))
    const second = cookieOf(await loginPost(port, 'bob', 'bob-pass'))
    expect(second).not.toBe(first)
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${first}` } }))
      .resolves.toMatchObject({ status: 200 })
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${second}` } }))
      .resolves.toMatchObject({ status: 200 })
    const store = await import('node:fs/promises').then(fs => fs.readFile(paths.store, 'utf8'))
    const doc = JSON.parse(store) as { version: number; sessions: { id: string; lastSeenAt: number }[] }
    expect(doc.version).toBe(2)
    expect(doc.sessions.map(session => session.id).sort()).toEqual([first, second].sort())
    for (const session of doc.sessions) expect(session.lastSeenAt).toBeGreaterThan(0)
  })

  it('evicts the least recently seen session when the per-login cap is exceeded', { timeout: 60_000 }, async () => {
    const { server, port } = await loadComposition({ maxSessionsPerUser: 2 })
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    const first = cookieOf(await loginPost(port, 'bob', 'bob-pass'))
    await new Promise(resolve => setTimeout(resolve, 10))
    const second = cookieOf(await loginPost(port, 'bob', 'bob-pass'))
    // The probe refreshes the first session's lastSeenAt past the second's,
    // so minting order and recency order disagree.
    await new Promise(resolve => setTimeout(resolve, 10))
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${first}` } }))
      .resolves.toMatchObject({ status: 200 })
    const third = cookieOf(await loginPost(port, 'bob', 'bob-pass'))
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${first}` } }))
      .resolves.toMatchObject({ status: 200 })
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${second}` } }))
      .resolves.toMatchObject({ status: 401 })
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${third}` } }))
      .resolves.toMatchObject({ status: 200 })
  })

  it('logout revokes only the presented session', { timeout: 60_000 }, async () => {
    const { server, port, paths } = await loadComposition()
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    const first = cookieOf(await loginPost(port, 'bob', 'bob-pass'))
    const second = cookieOf(await loginPost(port, 'bob', 'bob-pass'))
    const out = await request(port, '/logout', { method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${first}` } })
    expect(out.status).toBe(303)
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${first}` } }))
      .resolves.toMatchObject({ status: 401 })
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${second}` } }))
      .resolves.toMatchObject({ status: 200 })
    const store = await import('node:fs/promises').then(fs => fs.readFile(paths.store, 'utf8'))
    const doc = JSON.parse(store) as { sessions: { id: string }[] }
    expect(doc.sessions.map(session => session.id)).toEqual([second])
  })

  it('fails loud on a version-1 session store', { timeout: 60_000 }, async () => {
    const boot = await loadComposition()
    await boot.ctx.fiber.dispose()
    await import('node:fs/promises').then(fs => fs.writeFile(join(root!, 'legacy.json'), JSON.stringify({ version: 1, sessions: [] })))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(loadComposition({ sessionStore: join(root!, 'legacy.json') })).rejects.toThrow(/unsupported session store version 1/)
    warn.mockRestore()
  })
})

describe('webauth administration service', () => {
  it('creates an account, lists it, and the new login works at once', { timeout: 60_000 }, async () => {
    const { ctx, server, port, paths } = await loadComposition()
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    const auth = ctx.get('webAuth')!
    await auth.createUser({ login: 'carol', password: 'parol-parol', role: 'user' })

    const listed = auth.listUsers()
    expect(listed.map(user => [user.login, user.role])).toEqual([['bob', 'user'], ['carol', 'user']])
    expect((await storedUsers(paths.userStore)).map(user => user.login)).toEqual(['bob', 'carol'])

    // The new account logs in immediately and gets its own cabinet.
    const good = await loginPost(port, 'carol', 'parol-parol')
    expect(good.status).toBe(303)
    expect(ctx.get('webAuth')?.identityFromCookie(`${SESSION_COOKIE}=${cookieOf(good)}`)?.login).toBe('carol')

    // A second carol is refused, and a short password is refused.
    await expect(auth.createUser({ login: 'carol', password: 'parol-parol', role: 'user' }))
      .rejects.toMatchObject({ code: 'user-exists' })
    await expect(auth.createUser({ login: 'dave', password: 'коротко', role: 'user' }))
      .rejects.toMatchObject({ code: 'invalid-input' })
    // A login outside the charset is refused.
    await expect(auth.createUser({ login: '../evil', password: 'parol-parol', role: 'user' }))
      .rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('resetPassword revokes every session of the login and the new password admits', { timeout: 60_000 }, async () => {
    const { ctx, server, port } = await loadComposition()
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    const auth = ctx.get('webAuth')!
    const first = cookieOf(await loginPost(port, 'bob', 'bob-pass'))
    const second = cookieOf(await loginPost(port, 'bob', 'bob-pass'))
    await auth.resetPassword('bob', 'novyi-parol')

    for (const dead of [first, second]) {
      await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${dead}` } }))
        .resolves.toMatchObject({ status: 401 })
    }
    const stale = await loginPost(port, 'bob', 'bob-pass')
    expect(stale.status).toBe(303)
    expect(stale.headers.get('location')).toBe('/login?error=1')
    const fresh = await loginPost(port, 'bob', 'novyi-parol')
    expect(fresh.status).toBe(303)
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${cookieOf(fresh)}` } }))
      .resolves.toMatchObject({ status: 200 })

    // Unknown login and short password are typed refusals.
    await expect(auth.resetPassword('ghost', 'novyi-parol')).rejects.toMatchObject({ code: 'user-not-found' })
    await expect(auth.resetPassword('bob', 'коротко')).rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('setRole flips the admin flag live and guards the last admin', { timeout: 60_000 }, async () => {
    const { ctx, server, port } = await loadComposition()
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    const auth = ctx.get('webAuth')!
    await auth.createUser({ login: 'carol', password: 'parol-parol', role: 'admin' })
    // A second admin makes every later demotion legal.
    await auth.setRole('bob', 'admin')
    const cookie = cookieOf(await loginPost(port, 'carol', 'parol-parol'))
    expect(ctx.get('webAuth')?.identityFromCookie(`${SESSION_COOKIE}=${cookie}`)?.admin).toBe(true)

    // Demotion lands on the live session without revoking it.
    await auth.setRole('carol', 'user')
    expect(ctx.get('webAuth')?.identityFromCookie(`${SESSION_COOKIE}=${cookie}`)?.admin).toBe(false)

    // The last admin cannot be demoted or deleted.
    await expect(auth.setRole('bob', 'admin')).resolves.toBeUndefined()
    await expect(auth.setRole('bob', 'user')).rejects.toMatchObject({ code: 'last-admin' })
    await expect(auth.deleteUser('bob')).rejects.toMatchObject({ code: 'last-admin' })
    await expect(auth.setRole('ghost', 'admin')).rejects.toMatchObject({ code: 'user-not-found' })
  })

  it('deleteUser revokes the login’s sessions and closes the account', { timeout: 60_000 }, async () => {
    const { ctx, server, port, paths } = await loadComposition()
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    const auth = ctx.get('webAuth')!
    await auth.createUser({ login: 'carol', password: 'parol-parol', role: 'user' })
    const cookie = cookieOf(await loginPost(port, 'carol', 'parol-parol'))
    await request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } })

    await auth.deleteUser('carol')
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }))
      .resolves.toMatchObject({ status: 401 })
    const closed = await loginPost(port, 'carol', 'parol-parol')
    expect(closed.status).toBe(303)
    expect(closed.headers.get('location')).toBe('/login?error=1')
    expect(auth.listUsers().map(user => user.login)).toEqual(['bob'])
    expect((await storedUsers(paths.userStore)).map(user => user.login)).toEqual(['bob'])
    await expect(auth.deleteUser('carol')).rejects.toMatchObject({ code: 'user-not-found' })
  })

  it('lists and revokes devices per login', { timeout: 60_000 }, async () => {
    const { ctx, server, port } = await loadComposition()
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    const auth = ctx.get('webAuth')!
    const first = cookieOf(await loginPost(port, 'bob', 'bob-pass'))
    const second = cookieOf(await loginPost(port, 'bob', 'bob-pass'))

    const devices = auth.listDevices('bob')
    expect(devices.map(device => device.sessionId).sort()).toEqual([first, second].sort())
    for (const device of devices) {
      expect(device.issuedAt).toBeGreaterThan(0)
      expect(device.expiresAt).toBeGreaterThan(device.issuedAt)
      expect(device.lastSeenAt).toBeGreaterThan(0)
    }

    // Revoking one device kills exactly that session.
    await auth.revokeDevice('bob', first)
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${first}` } }))
      .resolves.toMatchObject({ status: 401 })
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${second}` } }))
      .resolves.toMatchObject({ status: 200 })
    expect(auth.listDevices('bob').map(device => device.sessionId)).toEqual([second])
    await expect(auth.revokeDevice('bob', first)).rejects.toMatchObject({ code: 'device-not-found' })
    await expect(auth.revokeDevice('ghost', first)).rejects.toMatchObject({ code: 'user-not-found' })

    // Revoking the rest clears the login's devices in one call.
    await expect(auth.revokeAllDevices('bob')).resolves.toBe(1)
    expect(auth.listDevices('bob')).toEqual([])
    await expect(request(port, '/probe', { headers: { cookie: `${SESSION_COOKIE}=${second}` } }))
      .resolves.toMatchObject({ status: 401 })
    await expect(auth.revokeAllDevices('ghost')).rejects.toMatchObject({ code: 'user-not-found' })
  })

  it('listUsers is ordered by login', { timeout: 60_000 }, async () => {
    const { ctx } = await loadComposition()
    const auth = ctx.get('webAuth')!
    await auth.createUser({ login: 'zeta', password: 'parol-parol', role: 'user' })
    await auth.createUser({ login: 'alpha', password: 'parol-parol', role: 'admin' })
    expect(auth.listUsers().map(user => [user.login, user.role])).toEqual([['alpha', 'admin'], ['bob', 'user'], ['zeta', 'user']])
  })
})
