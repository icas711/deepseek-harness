/**
 * Task-status watcher: the Consumer half of the telegram package. The
 * supervisor exposes no event feed, so the watcher polls `list()` and diffs
 * statuses in memory: every transition into a notifiable status produces at
 * most one active notification per (task, status) pair — a pair re-arms
 * only after the task leaves that status. The station return adds one
 * transition-kind: waiting-station -> running delivers `resumed` once per
 * such transition. A pair with no delivered send stays unnotified, so the
 * next tick retries it (a user who binds later still receives the
 * notification).
 * @module @deepseek-ai/dsh-telegram-notifier/watcher
 */

import type { NotificationKind, NotificationRequest, SendResult } from '@deepseek-ai/dsh-notifier'
import type { TaskStatus, TaskView } from '@deepseek-ai/dsh-task-supervisor'

/** The supervisor face the watcher reads. */
export interface TaskSource {
  /**
   * Fresh copies of every task record.
   * @returns the records in registry order.
   */
  list(): Promise<readonly TaskView[]>
}

/** The notifier face the watcher drives (the seam’s enumeration and send). */
export interface NotifierFace {
  /**
   * Enumerate the logins that currently hold a binding.
   * @returns the bound logins.
   */
  boundLogins(): Promise<string[]>

  /**
   * Send one notification to one login’s bound destination.
   * @param request - the notification to deliver.
   * @returns the send outcome.
   * @throws on a delivery failure.
   */
  send(request: NotificationRequest): Promise<SendResult>
}

/** Statuses worth a notification; `running` means live work, not news — its
 * one newsworthy edge, the station return, is a transition, not a status. */
const NOTIFIABLE_KINDS: readonly NotificationKind[] = ['paused', 'interrupted', 'waiting-station', 'completed', 'failed']

/**
 * Map a task status to its notification kind.
 * @param status - the observed task status.
 * @returns the kind, or undefined for a status that is not news.
 */
function toKind(status: TaskStatus): NotificationKind | undefined {
  return (NOTIFIABLE_KINDS as readonly string[]).includes(status) ? (status as NotificationKind) : undefined
}

/** Polling watcher over the task registry with per-pair notification dedup. */
export class TaskWatcher {
  /** Pairs this watcher has actively notified; pruned when the pair disappears. */
  private readonly notified = new Set<string>()
  /** Statuses observed on the previous tick; the transition source for `resumed`. */
  private readonly previous = new Map<string, TaskStatus>()
  /** Tasks whose `resumed` transition was delivered; observing `waiting-station` re-arms them. */
  private readonly resumedNotified = new Set<string>()
  private timer: NodeJS.Timeout | undefined
  private stopped = false

  /**
   * Construct the watcher.
   * @param source - the task registry to poll.
   * @param notifier - the delivery face; a rejected send leaves the pair
   * unnotified, so the next tick retries it.
   * @param onError - the sink for tick and delivery failures; the watcher
   * never lets one escape the timer chain.
   */
  constructor(
    private readonly source: TaskSource,
    private readonly notifier: NotifierFace,
    private readonly onError: (error: unknown) => void,
  ) {}

  /**
   * One poll: diff statuses against the previous tick, deliver one
   * notification per bound login for every newly notifiable pair, then prune
   * pairs that no longer exist.
   * @throws whatever `list()` or `boundLogins()` throws; delivery failures
   * are contained to their record and reported through the error sink.
   */
  async pollOnce(): Promise<void> {
    const records = await this.source.list()
    const logins = await this.notifier.boundLogins()
    const current = new Set<string>()
    const seen = new Set<string>()
    for (const record of records) {
      const taskId = String(record.taskId)
      seen.add(taskId)
      // The station return: waiting-station -> running means the bound
      // station reconnected and the supervisor resumed the task. One active
      // notification per transition; observing waiting-station again re-arms
      // it. A failed or unbound delivery stays unmarked and retries on the
      // next tick, like every other pair.
      if (
        this.previous.get(taskId) === 'waiting-station'
        && record.status === 'running'
        && !this.resumedNotified.has(taskId)
        && logins.length > 0
      ) {
        let delivered = false
        for (const login of logins) {
          try {
            const result = await this.notifier.send({ login, kind: 'resumed', title: record.title, sessionId: record.sessionId })
            if (result === 'sent') delivered = true
          } catch (error) {
            this.onError(error)
          }
        }
        if (delivered) this.resumedNotified.add(taskId)
      }
      if (record.status === 'waiting-station') this.resumedNotified.delete(taskId)
      this.previous.set(taskId, record.status)
      const kind = toKind(record.status)
      if (kind === undefined) continue
      const pair = `${taskId}:${record.status}`
      current.add(pair)
      if (this.notified.has(pair) || logins.length === 0) continue
      let delivered = false
      for (const login of logins) {
        try {
          const result = await this.notifier.send({ login, kind, title: record.title, sessionId: record.sessionId })
          if (result === 'sent') delivered = true
        } catch (error) {
          this.onError(error)
        }
      }
      if (delivered) this.notified.add(pair)
    }
    for (const pair of this.notified) {
      if (!current.has(pair)) this.notified.delete(pair)
    }
    for (const taskId of [...this.previous.keys()]) {
      if (!seen.has(taskId)) this.previous.delete(taskId)
    }
    for (const taskId of [...this.resumedNotified]) {
      if (!seen.has(taskId)) this.resumedNotified.delete(taskId)
    }
  }

  /**
   * Start the polling chain; one timer at a time, so ticks never overlap.
   * @param intervalMs - the poll period.
   */
  start(intervalMs: number): void {
    this.stopped = false
    this.arm(intervalMs)
  }

  /**
   * Stop the chain; a running tick finishes, and the next one never arms.
   */
  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  /** Arm the next tick. */
  private arm(intervalMs: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => {
      void this.tick(intervalMs)
    }, intervalMs)
    // The watcher must never keep a server process alive by itself.
    this.timer.unref()
  }

  /** Run one poll and re-arm whatever the outcome. */
  private async tick(intervalMs: number): Promise<void> {
    try {
      await this.pollOnce()
    } catch (error) {
      this.onError(error)
    } finally {
      this.arm(intervalMs)
    }
  }
}
