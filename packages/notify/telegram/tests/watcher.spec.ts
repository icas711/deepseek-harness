import { describe, expect, it, vi } from 'vitest'
import type { NotificationKind, NotificationRequest, SendResult } from '@deepseek-ai/dsh-notifier'
import type { TaskView } from '@deepseek-ai/dsh-task-supervisor'
import { TaskWatcher } from '../src/watcher.ts'
import type { NotifierFace, TaskSource } from '../src/watcher.ts'

/** One fake task record; ids stay plain strings (a fake source, not the store). */
function record(taskId: string, status: string, title = 'Работа'): TaskView {
  return { taskId, sessionId: `s-${taskId}`, title, status, updatedAt: 1 } as unknown as TaskView
}

/** Send + binding double capturing what the watcher delivered. */
class FakeNotifier implements NotifierFace {
  readonly sent: NotificationRequest[] = []
  logins: string[] = []
  outcome: ((request: NotificationRequest) => SendResult | Promise<SendResult>)[] = []

  async boundLogins(): Promise<string[]> {
    return this.logins
  }

  async send(request: NotificationRequest): Promise<SendResult> {
    this.sent.push(request)
    const outcome = this.outcome.shift()
    if (outcome !== undefined) return await outcome(request)
    return 'sent'
  }
}

const KIND: NotificationKind = 'paused'

function makeWatcher(records: TaskView[], notifier: FakeNotifier) {
  const errors: unknown[] = []
  const source: TaskSource = { list: async () => records }
  const watcher = new TaskWatcher(source, notifier, (error) => { errors.push(error) })
  return { watcher, errors }
}

describe('TaskWatcher diff and dedup', () => {
  it('notifies a newly observed pair once and stays quiet on the next poll', async () => {
    const notifier = new FakeNotifier()
    notifier.logins = ['anna']
    const records = [record('t1', 'paused')]
    const { watcher } = makeWatcher(records, notifier)
    await watcher.pollOnce()
    await watcher.pollOnce()
    expect(notifier.sent).toHaveLength(1)
    expect(notifier.sent[0]).toMatchObject({ login: 'anna', kind: KIND, title: 'Работа', sessionId: 's-t1' })
  })

  it('re-arms a pair after the task leaves the status and returns', async () => {
    const notifier = new FakeNotifier()
    notifier.logins = ['anna']
    const records = [record('t1', 'paused')]
    const { watcher } = makeWatcher(records, notifier)
    await watcher.pollOnce()
    records[0] = record('t1', 'running')
    await watcher.pollOnce()
    records[0] = record('t1', 'paused')
    await watcher.pollOnce()
    expect(notifier.sent).toHaveLength(2)
  })

  it('never notifies the running status', async () => {
    const notifier = new FakeNotifier()
    notifier.logins = ['anna']
    const { watcher } = makeWatcher([record('t1', 'running')], notifier)
    await watcher.pollOnce()
    expect(notifier.sent).toHaveLength(0)
  })

  it('maps each notifiable status to its kind', async () => {
    const notifier = new FakeNotifier()
    notifier.logins = ['anna']
    const { watcher } = makeWatcher([
      record('t1', 'paused'),
      record('t2', 'interrupted'),
      record('t3', 'waiting-station'),
      record('t4', 'completed'),
      record('t5', 'failed'),
    ], notifier)
    await watcher.pollOnce()
    expect(notifier.sent.map(sent => sent.kind)).toEqual(['paused', 'interrupted', 'waiting-station', 'completed', 'failed'])
  })

  it('notifies the station return once per waiting-station to running transition', async () => {
    const notifier = new FakeNotifier()
    notifier.logins = ['anna']
    const records = [record('t1', 'waiting-station')]
    const { watcher } = makeWatcher(records, notifier)
    await watcher.pollOnce()
    records[0] = record('t1', 'running')
    await watcher.pollOnce()
    // running is not news on its own: the next tick stays quiet.
    await watcher.pollOnce()
    expect(notifier.sent.map(sent => sent.kind)).toEqual(['waiting-station', 'resumed'])
    // A new offline window re-arms the transition.
    records[0] = record('t1', 'waiting-station')
    await watcher.pollOnce()
    records[0] = record('t1', 'running')
    await watcher.pollOnce()
    expect(notifier.sent.map(sent => sent.kind)).toEqual(['waiting-station', 'resumed', 'waiting-station', 'resumed'])
  })

  it('retries a failed resumed delivery on the next tick', async () => {
    const notifier = new FakeNotifier()
    notifier.logins = ['anna']
    notifier.outcome = [() => 'sent' as const, () => {
      throw new Error('telegram down')
    }]
    const records = [record('t1', 'waiting-station')]
    const { watcher, errors } = makeWatcher(records, notifier)
    await watcher.pollOnce()
    records[0] = record('t1', 'running')
    await watcher.pollOnce()
    expect(errors).toHaveLength(1)
    // The failed resumed delivery stays unnotified and retries next tick.
    await watcher.pollOnce()
    expect(notifier.sent.map(sent => sent.kind)).toEqual(['waiting-station', 'resumed'])
  })

  it('never invents the resumed transition without the observed waiting status', async () => {
    const notifier = new FakeNotifier()
    const records = [record('t1', 'waiting-station')]
    const { watcher } = makeWatcher(records, notifier)
    await watcher.pollOnce()
    records[0] = record('t1', 'running')
    // No bindings at the transition tick: the diff loses the edge, like every
    // fast transition this poll-based watcher can miss.
    await watcher.pollOnce()
    notifier.logins = ['anna']
    await watcher.pollOnce()
    expect(notifier.sent).toHaveLength(0)
  })

  it('broadcasts to every bound login and marks the pair after any delivery', async () => {
    const notifier = new FakeNotifier()
    notifier.logins = ['anna', 'oleg']
    notifier.outcome = [() => {
      return 'unbound' as const
    }]
    const { watcher } = makeWatcher([record('t1', 'paused')], notifier)
    await watcher.pollOnce()
    expect(notifier.sent.map(sent => sent.login)).toEqual(['anna', 'oleg'])
    await watcher.pollOnce()
    expect(notifier.sent).toHaveLength(2)
  })

  it('retries a pair whose send failed, reporting through the error sink', async () => {
    const notifier = new FakeNotifier()
    notifier.logins = ['anna']
    notifier.outcome = [() => {
      throw new Error('telegram down')
    }]
    const { watcher, errors } = makeWatcher([record('t1', 'paused')], notifier)
    await watcher.pollOnce()
    expect(errors).toHaveLength(1)
    await watcher.pollOnce()
    expect(notifier.sent).toHaveLength(2)
  })

  it('retries a pair once a binding appears', async () => {
    const notifier = new FakeNotifier()
    const { watcher } = makeWatcher([record('t1', 'paused')], notifier)
    await watcher.pollOnce()
    expect(notifier.sent).toHaveLength(0)
    notifier.logins = ['anna']
    await watcher.pollOnce()
    expect(notifier.sent).toHaveLength(1)
  })

  it('prunes pairs whose task disappeared, so a return notifies again', async () => {
    const notifier = new FakeNotifier()
    notifier.logins = ['anna']
    const records = [record('t1', 'paused')]
    const { watcher } = makeWatcher(records, notifier)
    await watcher.pollOnce()
    records.length = 0
    await watcher.pollOnce()
    records.push(record('t1', 'paused'))
    await watcher.pollOnce()
    expect(notifier.sent).toHaveLength(2)
  })

  it('contains a list failure in the tick and keeps the chain alive', async () => {
    const notifier = new FakeNotifier()
    notifier.logins = ['anna']
    let fail = true
    const source: TaskSource = {
      list: async () => {
        if (fail) throw new Error('registry gone')
        return [record('t1', 'completed')]
      },
    }
    const errors: unknown[] = []
    const watcher = new TaskWatcher(source, notifier, (error) => { errors.push(error) })
    watcher.start(5)
    await vi.waitFor(() => {
      expect(errors.length).toBeGreaterThan(0)
    }, { timeout: 2_000, interval: 10 })
    fail = false
    await vi.waitFor(() => {
      expect(notifier.sent).toHaveLength(1)
    }, { timeout: 2_000, interval: 10 })
    watcher.stop()
  })

  it('stops the chain and never arms again', async () => {
    const notifier = new FakeNotifier()
    notifier.logins = ['anna']
    const records = [record('t1', 'paused')]
    const { watcher } = makeWatcher(records, notifier)
    watcher.start(5)
    await vi.waitFor(() => {
      expect(notifier.sent).toHaveLength(1)
    }, { timeout: 2_000, interval: 10 })
    watcher.stop()
    const count = notifier.sent.length
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(notifier.sent).toHaveLength(count)
  })
})
