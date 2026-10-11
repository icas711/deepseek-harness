// Keyless assembled-app snapshot for the worktree-fanout fleet: the headless
// app drives the complete fleet_* tool cycle over a temporary deterministic git
// repository, one member replays a scripted answer, the owner receives the
// first-turn-end completion notice, and the member session log plus the
// stream-json transcript are compared against committed expected outputs.
import { execFile } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { normalizeSessionLog, normalizeStdout, scrubRequestHeaders } from '@deepseek-ai/dsh-acp-snapshot'
import type { NormalizeContext } from '@deepseek-ai/dsh-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { decompressZstdFrame, scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const scenarioDir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots', 'fleet-tools')
const configPath = fileURLToPath(new URL('../fleet.cordis.snapshot.yml', import.meta.url))
const parentReplay = join(scenarioDir, 'parent.replay.jsonl')
const memberReplay = join(scenarioDir, 'member.replay.jsonl')
const memberExpected = join(scenarioDir, 'member.expected.jsonl')
const streamExpected = join(scenarioDir, 'stream-json.expected.jsonl')
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

interface JsonObject {
  [key: string]: unknown
}

function parseJsonl(content: string): JsonObject[] {
  return content.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JsonObject)
}

/**
 * Tokenize the fleet's run-volatile artifacts after the shared scrubbers: the
 * generated worktree root (`<cwd>-dsh-fleet/<short8>/m<i>`) keeps its cwd prefix
 * untokenized (`-` is not a path boundary for {@link normalizeSessionLog}) and
 * the short fanout id is not UUID-shaped, so both are replaced here with stable
 * tokens in canonical (`/`) separator form.
 * @param text - the already-shared-normalized JSONL or stream text.
 * @param runCwd - the run's real working directory spelling.
 * @returns the text with `{{cwd}}-dsh-fleet/{{fanoutShort}}/m<i>` spellings tokenized.
 */
function normalizeFleetArtifacts(text: string, runCwd: string): string {
  const escapedCwd = runCwd.replaceAll('\\', '\\\\')
  return text
    .split(`${escapedCwd}-dsh-fleet`).join('{{cwd}}-dsh-fleet')
    .split(`${runCwd}-dsh-fleet`).join('{{cwd}}-dsh-fleet')
    .replace(/-dsh-fleet[\\/]+[0-9a-f]{8}([\\/]+m\d)/g, (_match, tail: string) =>
      `-dsh-fleet/{{fanoutShort}}${tail.replace(/[\\]+/g, '/')}`)
    .replace(/dsh-fleet\/[0-9a-f]{8}\/m(\d)/g, (_match, index: string) => `dsh-fleet/{{fanoutShort}}/m${index}`)
}

async function readPersistedLog(file: string): Promise<string> {
  const content = await readFile(file)
  if (!file.endsWith('.zstd')) return content.toString('utf8')
  const scan = scanZstdFrames(content)
  if (scan.tornStart !== undefined) throw new Error(`persisted snapshot log has a torn Zstandard frame: ${file}`)
  const decoded: Buffer[] = []
  for (const frame of scan.frames) {
    decoded.push(await decompressZstdFrame(content.subarray(frame.start, frame.end)))
  }
  return Buffer.concat(decoded).toString('utf8')
}

async function persistedLogs(cwd: string): Promise<{ content: string; header: JsonObject }[]> {
  const root = join(cwd, '.sessions')
  const files = (await readdir(root, { recursive: true }))
    .filter(file => file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd'))
  return Promise.all(files.map(async (file) => {
    const content = await readPersistedLog(join(root, file))
    return { content, header: parseJsonl(content)[0] ?? {} }
  }))
}

/**
 * Initialize the run directory as a git repository whose single commit is
 * byte-deterministic across runs and platforms (pinned author/committer
 * identity and dates), so the fanout base sha needs no scrubbing.
 * @param cwd - the run's working directory, which becomes the base repository.
 */
async function prepareDeterministicRepo(cwd: string): Promise<void> {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'fleet snapshot',
    GIT_AUTHOR_EMAIL: 'fleet@snapshot.test',
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00.000Z',
    GIT_COMMITTER_NAME: 'fleet snapshot',
    GIT_COMMITTER_EMAIL: 'fleet@snapshot.test',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:00.000Z',
  }
  const git = (args: string[]): Promise<{ stdout: string }> => execFileAsync('git', ['-C', cwd, ...args], { env })
  await git(['init', '-b', 'main'])
  await writeFile(join(cwd, 'hello.txt'), 'hello fleet\n')
  await git(['add', '.'])
  await git(['commit', '-m', 'init'])
}

describe('fleet worktree-fanout snapshots', () => {
  it('replays the full fleet tool cycle through the one-shot app', async () => {
    const task = 'Fan out one attempt, review the status and diff, merge the winner, clean up, then acknowledge the notice.'
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'fleet worktree-fanout headless stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-fleet-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, task],
      tsconfigPath,
      env: {
        DSH_SNAPSHOT_FILE: parentReplay,
        DSH_SNAPSHOT_CHILD_FILES: memberReplay,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: async (cwd) => {
        runCwd = cwd
        await prepareDeterministicRepo(cwd)
      },
      inspect: async (cwd) => {
        const logs = await persistedLogs(cwd)
        expect(logs).toHaveLength(2)
        const owner = logs.find(log => log.header.cwd === runCwd)
        const member = logs.find(log => typeof log.header.cwd === 'string' && log.header.cwd.includes('-dsh-fleet'))
        if (owner === undefined || member === undefined) throw new Error('missing persisted owner or member log')

        const ownerRecords = parseJsonl(owner.content)
        const calls = ownerRecords.filter(record => record.type === 'tool/call')
        expect(calls.map(record => (record.data as JsonObject | undefined)?.name)).toEqual([
          'fleet_fanout', 'fleet_status', 'fleet_diff', 'fleet_merge', 'fleet_cleanup',
        ])
        const notice = ownerRecords.filter(record => record.type === 'agent/inbox/spliced')
          .flatMap(record => (record.data as JsonObject | undefined)?.inserted ?? [])
          .map(message => JSON.stringify(message))
          .find(text => text.includes(' finished.'))
        expect(notice).toContain('Review with fleet_diff and pick a winner with fleet_merge.')

        const context: NormalizeContext = {
          sessionIds: [String(owner.header.id), String(member.header.id)],
          cwd: runCwd,
        }
        const normalizedMember = normalizeFleetArtifacts(
          scrubRequestHeaders(normalizeSessionLog(member.content, context)),
          runCwd,
        )
        if (refreshing) await writeFile(memberExpected, normalizedMember)
        expect(normalizedMember).toBe(await readFile(memberExpected, 'utf8'))
        expect(normalizedMember).toContain('ATTEMPT_DONE')
        expect(normalizedMember).toContain('{{cwd}}-dsh-fleet/{{fanoutShort}}/m1')
      },
    })

    expect(result.stderr).toBe('')
    const records = parseJsonl(result.stdout)
    expect(records.at(-1)).toMatchObject({ type: 'result', output: 'FLEET_CYCLE_DONE' })
    const sessionIds = [...new Set(records.flatMap(record => typeof record.sessionId === 'string' ? [record.sessionId] : []))]
    expect(sessionIds).toHaveLength(1)
    const context: NormalizeContext = { sessionIds, cwd: runCwd }
    const events = records.slice(0, -1).map(record => record.event as JsonObject)
    const normalizedEvents = parseJsonl(scrubRequestHeaders(normalizeSessionLog(
      `${events.map(event => JSON.stringify(event)).join('\n')}\n`,
      context,
    )))
    const normalizedStream = normalizeFleetArtifacts(normalizeStdout(
      `${records.map((record, index) => index < normalizedEvents.length
        ? JSON.stringify({ ...record, event: normalizedEvents[index] })
        : JSON.stringify(record)).join('\n')}\n`,
      context,
    ), runCwd)
    if (refreshing) await writeFile(streamExpected, normalizedStream)
    expect(normalizedStream).toBe(await readFile(streamExpected, 'utf8'))
    expect(normalizedStream).toContain('fleet_fanout')
    expect(normalizedStream).toContain('FLEET_CYCLE_DONE')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
