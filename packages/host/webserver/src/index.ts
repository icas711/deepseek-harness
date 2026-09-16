/**
 * @deepseek-ai/dsh-host-webserver — Web route-registration plugin: a node:http
 * server plus the `webServer` service (HTTP and upgrade route registries,
 * index transform taps, and the single fallback seat for everything no route
 * claims). Knows no harness concepts and serves no files; the composing
 * application's frontend plugin owns dist serving through the fallback hook.
 * Web shape only — Electron loads dist over file:// and carries fetch over an
 * IPC bridge. This package never prints: the URL line belongs to the shell.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServer
  }
}

/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
export type WebRouteKind = 'exact' | 'prefix'

/** One named route registration. */
export interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** One exact-path HTTP upgrade registration. */
export interface WebUpgradeRoute {
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns protocol negotiation and the upgraded socket after dispatch. */
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/** Cookie that carries the credential after one successful presentation. */
const AUTH_COOKIE = 'dsh_web_token'

/** Query parameter accepting the credential on any path. */
const AUTH_QUERY = 'token'

/** The 401 body; its byte length is the upgrade denial's Content-Length. */
/** The 401 body the token gate answers with; exported for instance probes. */
export const UNAUTHORIZED_BODY = 'unauthorized'

/**
 * Gateway config: the listen address and the optional shared credential.
 */
export interface Config {
  /** Listen host; the two supported values are loopback and all-interfaces. */
  host: '127.0.0.1' | '0.0.0.0'
  /** Listen port; zero requests an OS-assigned port. */
  port: number
  /**
   * Shared credential every browser request must present — the `?token=`
   * query, an `Authorization: Bearer` header, or the session cookie a
   * presentation issues; absent admits every request. Validation rejects an
   * empty value: an empty secret would be a disabled gate, not a configured
   * one.
   */
  token?: string
}

/**
 * The named cookie's value from a Cookie header.
 * @param header - the request's raw Cookie header.
 * @param name - the cookie name to read.
 * @returns the cookie's value, or undefined when the header or cookie is absent.
 */
function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined
  for (const pair of header.split(';')) {
    const at = pair.indexOf('=')
    if (at !== -1 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim()
  }
  return undefined
}

/**
 * The credential of an `Authorization: Bearer` header; the scheme is
 * case-insensitive per RFC 9110.
 * @param header - the request's raw Authorization header.
 * @returns the credential, or undefined when the header is absent or not Bearer.
 */
function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '')
  return match?.[1]?.trim() || undefined
}

/**
 * The `?token=` query credential.
 * @param url - the parsed request URL.
 * @returns the parameter's value, or undefined when absent.
 */
function queryToken(url: URL): string | undefined {
  return url.searchParams.get(AUTH_QUERY) ?? undefined
}

/**
 * Whether one presented credential equals the configured token. Comparison
 * runs over SHA-256 digests: `timingSafeEqual` requires equal lengths, and the
 * digest comparison leaks neither the secret's length nor its content.
 * @param presented - the credential the request carried, if any.
 * @param token - the configured secret.
 * @returns whether the credential is the token.
 */
function tokenMatches(presented: string | undefined, token: string): boolean {
  if (presented === undefined) return false
  return timingSafeEqual(
    createHash('sha256').update(presented).digest(),
    createHash('sha256').update(token).digest(),
  )
}

/**
 * The session cookie issued after one successful presentation.
 * @param token - the configured secret.
 * @returns the Set-Cookie value binding the credential for the browser session.
 */
function sessionCookie(token: string): string {
  return `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`
}

/**
 * The browser HTTP carrier service. Activation listens immediately. Route
 * registration order does not affect requests because configured named routes
 * must be distinct, and the fallback handler answers anything not yet claimed
 * during startup with 404 until its owner registers. A configured `token`
 * gates every HTTP request and upgrade before route dispatch. A listen
 * failure rejects initialization, and the boot process reports the failed
 * fiber.
 */
export class WebServer extends Service {
  static Config: z<Config> = z.object({
    host: z.union([z.const('127.0.0.1'), z.const('0.0.0.0')]).required(),
    port: z.natural().max(65535).required(),
    token: z.string().min(1),
  })

  private readonly exact = new Map<string, WebRoute>()
  private readonly prefixes = new Map<string, WebRoute>()
  private readonly upgrades = new Map<string, WebUpgradeRoute>()
  private readonly upgradedSockets = new Set<Duplex>()
  private readonly indexTaps: ((html: string) => string)[] = []
  private fallback: WebRoute['handler'] | undefined
  private server!: Server
  private listenedPort!: number
  private listenerUp = false

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'webServer')
  }

  /** The listening port (the OS-assigned value when config.port is 0). */
  get port(): number {
    return this.listenedPort
  }

  /** The configured bind host (the loopback or all-interfaces literal). */
  get host(): Config['host'] {
    return this.config.host
  }

  /** Whether the listener is bound right now (false between stop and start). */
  get listening(): boolean {
    return this.listenerUp
  }

  /**
   * Close the listener and every connection (downlink upgrades included);
   * routes and registrations survive, so start() restores the same surface.
   * Converges when already stopped.
   */
  async stop(): Promise<void> {
    if (!this.listenerUp) return
    this.listenerUp = false
    await this.closeListener()
  }

  /**
   * Re-bind after a stop. The port is the one the first bind landed on — the
   * printed URL, `DSH_WEB_URL`, and browser bookmarks all name it — even when
   * the config asked for an OS-assigned one. Rejection (the port was taken
   * while stopped) leaves the server stopped; the caller retries.
   */
  async start(): Promise<void> {
    if (this.listenerUp) return
    await this.bind(this.listenedPort)
  }

  /** The token every request must present, or undefined when the gate is off. */
  get token(): string | undefined {
    return this.config.token
  }

  /**
   * Whether the request presents the configured token (always true without
   * one): the session cookie, a Bearer header, or the `?token=` query.
   * @param req - the request presenting credentials.
   * @param url - the parsed request URL.
   * @returns whether the request may proceed past the gate.
   */
  private presentsToken(req: IncomingMessage, url: URL): boolean {
    const token = this.config.token
    return token === undefined
      || tokenMatches(cookieValue(req.headers.cookie, AUTH_COOKIE), token)
      || tokenMatches(bearerToken(req.headers.authorization), token)
      || tokenMatches(queryToken(url), token)
  }

  /**
   * Enforce the token gate on one HTTP request, writing the 401 response or
   * the session cookie as the outcome requires.
   * @param req - the request presenting credentials.
   * @param res - the response the denial writes to.
   * @param url - the parsed request URL (the `?token=` source).
   * @returns whether the request is admitted.
   */
  private gateRequest(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
    const token = this.config.token
    if (token === undefined) return true
    if (!this.presentsToken(req, url)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(UNAUTHORIZED_BODY)
      return false
    }
    res.setHeader('set-cookie', sessionCookie(token))
    return true
  }

  /**
   * Deny one upgrade with a complete 401 response; the socket stays owned by
   * the caller's upgrade dispatch, which observes the close.
   * @param socket - the raw HTTP socket of the denied upgrade.
   */
  private denyUpgrade(socket: Duplex): void {
    socket.end([
      'HTTP/1.1 401 Unauthorized',
      'Connection: close',
      'Content-Type: text/plain; charset=utf-8',
      `Content-Length: ${String(Buffer.byteLength(UNAUTHORIZED_BODY))}`,
      '',
      UNAUTHORIZED_BODY,
    ].join('\r\n'))
  }

  /**
   * Register a named route. Duplicate (kind, path) throws — route patterns are
   * a composition-level contract, so a collision is a misconfiguration.
   * @param route - kind, path, and the owning handler.
   * @returns the disposer removing the route.
   */
  register(route: WebRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) {
      throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
    }
    table.set(route.path, route)
    return () => { table.delete(route.path) }
  }

  /**
   * Register an exact-path HTTP upgrade route. Duplicate paths throw because
   * one socket can have only one protocol owner.
   * @param route - pathname and handler owning negotiation plus socket use.
   * @returns the disposer removing the route.
   */
  registerUpgrade(route: WebUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) {
      throw new Error(`webserver: duplicate upgrade route "${route.path}"`)
    }
    this.upgrades.set(route.path, route)
    return () => { this.upgrades.delete(route.path) }
  }

  /**
   * Claim the fallback seat: the handler answering every request no named
   * route matches (the SPA dist server in the shipped Web composition). One
   * owner only — a second registration throws, because two fallbacks cannot
   * compose.
   * @param handler - owns the full response lifecycle of unmatched requests.
   * @returns the disposer releasing the seat.
   */
  registerFallback(handler: WebRoute['handler']): () => void {
    if (this.fallback !== undefined) {
      throw new Error('webserver: fallback already registered')
    }
    this.fallback = handler
    return () => { this.fallback = undefined }
  }

  /**
   * Register an index.html transform, applied by the fallback owner to every
   * index response ({@link applyIndexTaps}) in registration order.
   * @param transform - pure html-to-html function.
   * @returns the disposer removing the transform.
   */
  tapIndex(transform: (html: string) => string): () => void {
    this.indexTaps.push(transform)
    return () => {
      const at = this.indexTaps.indexOf(transform)
      if (at !== -1) this.indexTaps.splice(at, 1)
    }
  }

  /** Listen; resolves once the socket is bound (rejection = FAILED fiber). */
  async [Service.init](): Promise<void> {
    const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      /* v8 ignore next -- `?? '/'` arm: node:http always sets url on server
      requests; the field is only optional on the client-side IncomingMessage type */
      const url = new URL(req.url ?? '/', 'http://x')
      if (!this.gateRequest(req, res, url)) return
      const route = this.match(url.pathname)
      if (route !== undefined) {
        await route.handler(req, res)
        return
      }
      const fallback = this.fallback
      if (fallback === undefined) {
        res.writeHead(404)
        res.end()
        return
      }
      await fallback(req, res)
    }
    // Last-resort guard: handle() rejecting would otherwise be an unhandled
    // rejection killing the process on one malformed request (bad %-escape,
    // client dropping mid-body). Per-request failures log and answer 400 —
    // never a process exit.
    this.server = createServer((req, res) => {
      handle(req, res).catch((err: unknown) => {
        this.ctx.logger.warn(err instanceof Error ? err : new Error(String(err)))
        if (res.headersSent) {
          res.destroy()
          return
        }
        res.writeHead(400)
        res.end()
      })
    })
    this.server.on('upgrade', (req, socket, head) => {
      const onError = (error: Error): void => {
        this.ctx.logger.warn(error)
        socket.destroy()
      }
      socket.on('error', onError)
      socket.once('close', () => {
        socket.off('error', onError)
        this.upgradedSockets.delete(socket)
      })
      let url: URL
      try {
        /* v8 ignore next -- node:http always sets url on server requests. */
        url = new URL(req.url ?? '/', 'http://x')
      } catch (error) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        socket.destroy()
        return
      }
      if (!this.presentsToken(req, url)) {
        this.denyUpgrade(socket)
        return
      }
      const route = this.upgrades.get(url.pathname)
      if (route === undefined) {
        socket.destroy()
        return
      }
      this.upgradedSockets.add(socket)
      try {
        Promise.resolve(route.handler(req, socket, head)).catch((error: unknown) => {
          this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
          socket.destroy()
        })
      } catch (error) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        socket.destroy()
      }
    })

    await this.bind(this.config.port)

    // Node does not include upgraded sockets in closeAllConnections(). The service
    // owns them with the other connections, so it tracks and destroys them explicitly.
    this.ctx.effect(() => async () => {
      await this.closeListener()
    }, 'webServer.listen')
  }

  /** Bind the listener; resolves once the socket is bound (rejection = bind failure). */
  private bind(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, this.config.host, () => {
        this.server.off('error', reject)
        this.server.on('error', (err) => { this.ctx.logger.error(err) })
        this.listenedPort = (this.server.address() as AddressInfo).port
        this.listenerUp = true
        resolve()
      })
    })
  }

  /** Close the listener, every connection, and every tracked upgraded socket. */
  private async closeListener(): Promise<void> {
    const serverClosed = new Promise<void>((resolve) => {
      this.server.close(() => { resolve() })
    })
    this.server.closeAllConnections()
    const upgradedClosed = [...this.upgradedSockets].map(socket => new Promise<void>((resolve) => {
      socket.once('close', () => { resolve() })
      socket.destroy()
    }))
    await Promise.all([serverClosed, ...upgradedClosed])
  }

  /** Longest-prefix-wins over the prefix table after an exact-table miss. */
  private match(pathname: string): WebRoute | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact
    let best: WebRoute | undefined
    for (const [prefix, route] of this.prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
      if (best === undefined || prefix.length > best.path.length) best = route
    }
    return best
  }

  /**
   * Run an index.html body through the registered taps in registration order
   * — called by the fallback owner on every index response it renders.
   * @param html - the raw index.html body.
   * @returns the transformed body.
   */
  applyIndexTaps(html: string): string {
    let out = html
    for (const transform of this.indexTaps) out = transform(out)
    return out
  }
}

export default WebServer
