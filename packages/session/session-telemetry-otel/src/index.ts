/**
 * OpenTelemetry Service Provider for the DeepSeek Harness telemetry capability.
 *
 * Composes the OTel JS SDK as-is — a `LoggerProvider` with a
 * `BatchLogRecordProcessor` and an OTLP/HTTP log exporter — and maps each
 * record handed over by the capture coordinator onto `logger.emit()`. After that call,
 * batching, retry, queueing, and loss policy use the SDK's documented behavior, configured
 * verbatim through the `exporter`/`processor` passthroughs. This package owns
 * capture mode and an outer shutdown deadline: the SDK's export timeout does
 * not bound its preceding `forceFlush()` wait.
 *
 * Mode selection is layered: the composition entry is the base, and the
 * `session-telemetry` settings section overrides it live while a settings
 * provider is mounted. A mode change swaps the whole pipeline (coordinator
 * listeners plus SDK provider) for a fresh one on a disposable child fiber,
 * so live capture never leaks listeners from a superseded mode; the module
 * handoff cursor keeps a rebuild from re-exporting records the previous
 * incarnation already handed off.
 *
 * @module @deepseek-ai/dsh-session-telemetry-otel
 */

import { createRequire } from 'node:module'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-command-feedback'
import {
  SessionTelemetryBackend,
  SessionTelemetryCoordinator,
  type SessionTelemetrySink,
  type SessionTelemetryRecord,
  type SessionTelemetrySeverity,
  type SessionTelemetrySharingStatus,
} from '@deepseek-ai/dsh-session-telemetry'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { APP_IDENTITY } from '@deepseek-ai/dsh-llm'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type BatchLogRecordProcessorOptions,
} from '@opentelemetry/sdk-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import type { OTLPExporterNodeConfigBase } from '@opentelemetry/otlp-exporter-base'
import { SeverityNumber, type AnyValue, type Logger } from '@opentelemetry/api-logs'
import { resourceFromAttributes } from '@opentelemetry/resources'

// The package's own manifest is the single source of the instrumentation-scope
// version (same pattern as dsh-llm's attribution identity).
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

/** Session-sharing policy selected by {@link Config.mode}. */
export enum SessionTelemetryMode {
  FULL = 'FULL',
  FEEDBACK_ONLY = 'FEEDBACK_ONLY',
  DISABLED = 'DISABLED',
}

/** Default session-sharing policy for schema and direct construction. */
export const DEFAULT_TELEMETRY_MODE = SessionTelemetryMode.DISABLED

/** The settings namespace whose `mode` field overrides the composition entry live. */
export const TELEMETRY_SETTINGS_NS = settingsNamespace('session-telemetry')

const DISABLED_FEEDBACK_WARNING = 'session telemetry is DISABLED; nothing will be shared and this feedback remains local'
const NON_CANONICAL_FEEDBACK_WARNING = 'session telemetry ignored a feedback event absent from the canonical session log'
const DROP_RECORD: SessionTelemetrySink['emit'] = () => {}

/** Resolve the default and reject unknown runtime values before transport setup. */
function resolveMode(mode: SessionTelemetryMode | undefined): SessionTelemetryMode {
  const resolved = mode ?? DEFAULT_TELEMETRY_MODE
  switch (resolved) {
    case SessionTelemetryMode.FULL:
    case SessionTelemetryMode.FEEDBACK_ONLY:
    case SessionTelemetryMode.DISABLED:
      return resolved
    default:
      return assertNever(resolved)
  }
}

/** Fail closed when direct construction bypasses the runtime config schema. */
function assertNever(value: never): never {
  throw new Error(`session-telemetry-otel: unsupported mode ${JSON.stringify(value)}`)
}

/** Map the serialized mode onto the seam's backend-independent sharing vocabulary. */
export function sharingStatusFor(mode: SessionTelemetryMode): SessionTelemetrySharingStatus {
  switch (mode) {
    case SessionTelemetryMode.FULL: return 'full'
    case SessionTelemetryMode.FEEDBACK_ONLY: return 'feedback-only'
    case SessionTelemetryMode.DISABLED: return 'disabled'
    /* v8 ignore next 2 -- resolveMode already rejected unknown values before this switch; the closed enum cannot reach the default. */
    default: return assertNever(mode)
  }
}

/**
 * Plugin configuration: one sharing policy, two verbatim SDK option objects,
 * and one DSH-owned shutdown bound. Uploading modes validate their endpoint
 * and shutdown deadline at plugin load; `DISABLED` reads neither. When a
 * settings provider is mounted, the `session-telemetry` section's `mode`
 * overrides this entry live.
 */
export interface Config {
  /** Sharing policy; defaults to local-only `DISABLED` behavior. */
  mode?: SessionTelemetryMode
  /**
   * Passed verbatim to the SDK's OTLP/HTTP log exporter — the complete
   * `OTLPExporterNodeConfigBase` shape (`headers`, `timeoutMillis`,
   * `compression`, `keepAlive`, …), owned and documented by the SDK. `url`
   * is the one field this package requires and validates itself.
   */
  exporter?: OTLPExporterNodeConfigBase & {
    /** Full logs endpoint (e.g. `https://collector.example.com/v1/logs`). Required outside `DISABLED`; validated at load. */
    url?: string
  }
  /**
   * Passed verbatim to `BatchLogRecordProcessor` (minus the exporter slot,
   * which this plugin fills); the SDK owns and documents these knobs.
   */
  processor?: Omit<BatchLogRecordProcessorOptions, 'exporter'>
  /** Maximum time spent awaiting the SDK provider's complete shutdown path. */
  shutdownTimeoutMillis?: number
}

/**
 * Schemastery validator for {@link Config}; cordis runs it before the plugin
 * starts. It checks only the top-level fields; value checks live in the
 * pipeline constructor so their errors name the fields. Both SDK option
 * objects pass through unchanged: the SDK defines and validates their
 * fields. Re-declaring them here would silently drop every field this plugin
 * did not repeat.
 */
export const Config: z<Config> = z.object({
  mode: z.union(Object.values(SessionTelemetryMode)).default(DEFAULT_TELEMETRY_MODE),
  exporter: z.any(),
  processor: z.any(),
  shutdownTimeoutMillis: z.number(),
})

/** Default outer allowance for the SDK's complete shutdown sequence. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MILLIS = 3_000

// Node clamps larger timer delays to one millisecond. This is a runtime
// protocol limit, not a deployment default.
const MAX_TIMER_DELAY_MILLIS = 2_147_483_647

/** Severity mapping from the Service Definition's three-level vocabulary to OTel severity numbers. */
const SEVERITY: Record<SessionTelemetrySeverity, { severityNumber: SeverityNumber; severityText: string }> = {
  info: { severityNumber: SeverityNumber.INFO, severityText: 'INFO' },
  warn: { severityNumber: SeverityNumber.WARN, severityText: 'WARN' },
  error: { severityNumber: SeverityNumber.ERROR, severityText: 'ERROR' },
}

/**
 * Read and bound the shutdown deadline; uploading modes validate it at load.
 * @param config - the section the value comes from.
 * @returns the validated deadline in milliseconds.
 */
export function resolveShutdownTimeoutMillis(config: Config): number {
  const shutdownTimeoutMillis = config.shutdownTimeoutMillis ?? DEFAULT_SHUTDOWN_TIMEOUT_MILLIS
  if (!Number.isFinite(shutdownTimeoutMillis) || shutdownTimeoutMillis <= 0 || shutdownTimeoutMillis > MAX_TIMER_DELAY_MILLIS) {
    throw new Error(`session-telemetry-otel: shutdownTimeoutMillis must be a positive finite number no greater than ${MAX_TIMER_DELAY_MILLIS}, got ${String(shutdownTimeoutMillis)}`)
  }
  return shutdownTimeoutMillis
}

/** The validated transport constants one uploading pipeline runs with. */
export interface Transport {
  /** The complete exporter options, verbatim, with a validated `url`. */
  readonly exporter: OTLPExporterNodeConfigBase
  /** The complete processor options, verbatim, minus the exporter slot. */
  readonly processor: Omit<BatchLogRecordProcessorOptions, 'exporter'> | undefined
}

/**
 * Validate and detach the two SDK option objects for an uploading pipeline.
 * @param config - the section the values come from.
 * @returns the transport constants the pipeline constructs its SDK from.
 */
export function resolveTransport(config: Config): Transport {
  const exporter = config.exporter
  const url = exporter?.url
  if (exporter === undefined || url === undefined || url.length === 0) {
    throw new Error('session-telemetry-otel: exporter.url is required (the full OTLP logs endpoint)')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Re-thrown as a config error: the only way here is a malformed url string.
    throw new Error(`session-telemetry-otel: exporter.url is not a valid URL: ${JSON.stringify(url)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`session-telemetry-otel: exporter.url must be http(s), got ${parsed.protocol}`)
  }
  // The one processor field checked beyond the SDK's own validation: the
  // SDK accepts a non-positive batch size, but its shutdown drain then
  // splices empty batches without consuming the queue — dispose would hang
  // forever with records queued. Misconfiguration fails at load instead.
  const batchSize = config.processor?.maxExportBatchSize
  if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
    throw new Error(`session-telemetry-otel: processor.maxExportBatchSize must be a positive integer, got ${String(batchSize)}`)
  }
  return {
    exporter,
    processor: config.processor,
  }
}

/**
 * Ask the SDK to drain and quiesce, but reject after the backend-owned
 * deadline. OTel's processor export timeout wraps `exportCompleted` only;
 * shutdown awaits `exporter.forceFlush()` first, which can remain pending
 * when the transport never obtains a socket. The provider promise remains
 * observed after the deadline so a later rejection cannot become unhandled.
 * @param provider - the SDK pipeline to drain.
 * @param deadline - maximum wait in milliseconds.
 * @returns resolves when the pipeline quiesces, or rejects at the deadline.
 */
async function shutdownProvider(provider: LoggerProvider, deadline: number): Promise<void> {
  const providerShutdown = provider.shutdown()
  let timer: ReturnType<typeof setTimeout> | undefined
  const exceeded = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`session-telemetry-otel: provider shutdown exceeded ${deadline}ms`))
    }, deadline)
  })
  try {
    await Promise.race([providerShutdown, exceeded])
  } finally {
    /* v8 ignore else -- the Promise executor assigns timer synchronously before this race starts. */
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * One mode incarnation: the SDK pipeline plus its capture wiring, mounted on
 * a child plugin fiber the backend owns and can dispose wholesale. `DISABLED`
 * constructs no SDK state and listens only to warn when recorded feedback
 * stays local; `FULL` and `FEEDBACK_ONLY` wire the SDK pipeline and compose a
 * {@link SessionTelemetryCoordinator}.
 */
class Pipeline {
  /** Direct-record emit for the backend's service face; DROP outside `FULL`. */
  readonly directEmit: SessionTelemetrySink['emit']
  private readonly provider: LoggerProvider | undefined
  private readonly fiber: { dispose(): Promise<void> }
  private readonly deadline: number

  constructor(
    parent: Context,
    mode: SessionTelemetryMode,
    transport: Transport | undefined,
    deadline: number,
  ) {
    this.deadline = deadline
    const fiber = parent.plugin(() => {})
    this.fiber = fiber
    const ctx = fiber.ctx

    if (mode === SessionTelemetryMode.DISABLED) {
      this.directEmit = DROP_RECORD
      this.provider = undefined
      ctx.on('session/event', (_session, event) => {
        if (event.type === 'feedback/record') ctx.logger.warn(DISABLED_FEEDBACK_WARNING)
      })
      return
    }
    if (transport === undefined) throw new Error('session-telemetry-otel: uploading mode without validated transport')

    this.provider = new LoggerProvider({
      resource: resourceFromAttributes({
        'service.name': APP_IDENTITY.product,
        'service.version': APP_IDENTITY.version,
        // OTel semconv's standard user attribute, carried once per export
        // batch on the Resource rather than per record: the collector
        // aggregates by Resource, and the id is process-stable anyway.
        'user.id': getOrCreateAnonymousUserId(),
      }),
      processors: [
        new BatchLogRecordProcessor({
          ...transport.processor,
          // The complete validated exporter object, verbatim: every SDK
          // option (`timeoutMillis`, `compression`, `keepAlive`, …) reaches
          // the exporter — rebuilding selected fields here would silently
          // ignore the rest. App identity travels in the Resource
          // (service.name/version); the transport-level user-agent is the
          // SDK's own, per the axiom.
          exporter: new OTLPLogExporter(transport.exporter),
        }),
      ],
    })
    const ledger = this.provider.getLogger('@deepseek-ai/dsh-session-telemetry-otel', version)
    const ops = this.provider.getLogger('@deepseek-ai/dsh-session-telemetry-otel/ops', version)
    const enqueue: SessionTelemetrySink['emit'] = (record) => {
      const logger: Logger = record.channel === 'ops' ? ops : ledger
      logger.emit({
        timestamp: record.time,
        observedTimestamp: record.time,
        ...SEVERITY[record.severity],
        // JSON-serializable by the seam's contract (validated at Session.append),
        // which is exactly the AnyValue subset.
        body: record.body as AnyValue,
        attributes: record.attributes,
      })
    }
    const backend: SessionTelemetrySink = {
      emit: enqueue,
      shutdown: () => this.drain(),
    }
    if (mode === SessionTelemetryMode.FULL) {
      this.directEmit = enqueue
      new SessionTelemetryCoordinator(ctx, backend, 'live')
      return
    }
    this.directEmit = DROP_RECORD
    const coordinator = new SessionTelemetryCoordinator(ctx, backend, 'on-demand')
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'feedback/record') return
      // Consent is the committed record, not an independently emitted bus value.
      if (session.events[event.seq] !== event) {
        ctx.logger.warn(NON_CANONICAL_FEEDBACK_WARNING)
        return
      }
      coordinator.captureSession(session, event.seq)
    })
  }

  /**
   * Drain the SDK pipeline within the deadline; `DISABLED` resolves
   * immediately. Rejects at the deadline exactly like the service shutdown
   * contract.
   * @returns resolves when the pipeline quiesces, or rejects at the deadline.
   */
  async drain(): Promise<void> {
    if (this.provider === undefined) return
    await shutdownProvider(this.provider, this.deadline)
  }

  /**
   * Detach the capture listeners (disposing the child fiber also forwards to
   * the coordinator's own drain-and-mark dispose path), then drain this
   * pipeline's SDK. A failure in either step is contained: the mode swap
   * that triggered this close must never be blocked by the incarnation it
   * replaces.
   */
  async close(): Promise<void> {
    // Only a cordis fiber-teardown failure can reject here — the coordinator
    // contains its own shutdown path — and the drain below still runs.
    await this.fiber.dispose().then(() => undefined, () => undefined)
    await this.drain().then(() => undefined, () => undefined)
  }
}

/**
 * The backend plugin — the only entry a deployment loads. It always registers
 * the `telemetry` service (duplicate load throws) and serves one pipeline at
 * a time. The mode comes from the composition entry, overridden live by the
 * `session-telemetry` settings section while a settings provider is mounted;
 * each change swaps the pipeline and closes the previous one.
 */
export class OpenTelemetrySessionBackend extends SessionTelemetryBackend {
  static inject = ['sessions']
  static Config = Config

  private pipeline: Pipeline | undefined
  private directEmit: SessionTelemetrySink['emit'] = DROP_RECORD
  private currentMode: SessionTelemetryMode = DEFAULT_TELEMETRY_MODE
  /** Live sharing disclosure mirroring {@link currentMode} for acknowledgement surfaces. */
  override sharing: SessionTelemetrySharingStatus = sharingStatusFor(DEFAULT_TELEMETRY_MODE)

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // Uploading entries validate transport and deadline at load; `DISABLED`
    // reads neither, exactly as before — the values are resolved lazily on
    // the first uploading mount (a settings switch away from a DISABLED
    // entry validates then, and the settings registration refuses the write
    // outright when the section cannot support an uploading mode).
    let transport: Transport | undefined
    let deadline: number | undefined
    const resolveUploading = (): { transport: Transport; deadline: number } => {
      transport ??= resolveTransport(config)
      deadline ??= resolveShutdownTimeoutMillis(config)
      return { transport, deadline }
    }

    const mount = (mode: SessionTelemetryMode): void => {
      const next = mode === SessionTelemetryMode.DISABLED
        ? new Pipeline(ctx, mode, undefined, DEFAULT_SHUTDOWN_TIMEOUT_MILLIS)
        : new Pipeline(ctx, mode, resolveUploading().transport, resolveUploading().deadline)
      const previous = this.pipeline
      this.pipeline = next
      this.directEmit = next.directEmit
      this.currentMode = mode
      this.sharing = sharingStatusFor(mode)
      if (previous !== undefined) void previous.close()
    }
    mount(resolveMode(config.mode))

    // Live mode override: the settings section wins while mounted, and a
    // detach falls back to the composition entry. The registration rides the
    // backend's own fiber, so a settings provider that never mounts leaves
    // the entry mode standing.
    ctx.inject(['settings'], (settingsCtx) => {
      const scope = settingsCtx.settings.register(TELEMETRY_SETTINGS_NS, Config, {
        base: config,
        validate: (value) => {
          if (resolveMode(value.mode) === SessionTelemetryMode.DISABLED) return
          resolveTransport(value)
          resolveShutdownTimeoutMillis(value)
        },
      })
      const read = (): void => {
        const mode = resolveMode(scope.get().mode)
        if (mode === this.currentMode) return
        mount(mode)
      }
      read()
      const stop = scope.watch(read)
      settingsCtx.effect(() => stop, 'session-telemetry-otel: settings-mode watch')
      // A settings provider detaching leaves the backend running, so the
      // override source disappears: the composition entry stands again.
      settingsCtx.effect(() => () => {
        const mode = resolveMode(config.mode)
        if (mode !== this.currentMode) mount(mode)
      }, 'session-telemetry-otel: settings-detach fallback')
    })
  }

  /**
   * Hand a direct service record to the SDK only in `FULL`. Direct calls are
   * no-ops in `FEEDBACK_ONLY` and `DISABLED`; feedback replay uses a private
   * backend capability created only for the canonical feedback listener.
   * @param record - the logical record offered directly to the service.
   */
  emit(record: SessionTelemetryRecord): void {
    this.directEmit(record)
  }

  // The Service Definition's optional flush() hint is deliberately NOT implemented. The
  // batch processor exports on its own cadence (`processor.scheduledDelayMillis`,
  // the SDK's documented knob), and this backend is the SDK pipeline's only
  // caller — forwarding the hint to `forceFlush()` would be the sole source of
  // concurrent flushes, whose undocumented interactions with shutdown's
  // internal drain (concurrent-flush guard, provider-level flush timeout)
  // silently drop tail records. Rationale and the revival trigger: the
  // revival Agent Note.

  /**
   * Drain the active pipeline within the configured deadline, rejecting past
   * it, per the seam's shutdown contract; `DISABLED` has no provider and
   * resolves immediately. Draining an already-drained provider is the SDK's
   * own resolved-promise case, so repeated calls (turn ends aside, the
   * coordinator's dispose, an explicit service call) all settle. Pipeline
   * swaps stay with the settings watch — this method never detaches state.
   * @returns resolves when the SDK pipeline quiesces or is disabled, or rejects at the configured deadline.
   */
  async shutdown(): Promise<void> {
    await this.pipeline?.drain()
  }
}

export default OpenTelemetrySessionBackend
