/**
 * Model-facing fleet controller (`ctx.fleet`): five tools covering the worktree-fanout lifecycle — start,
 * observe, diff, merge the winner, clean up. Each attempt is a separate user-visible session in its own
 * git worktree; the tools return member session ids the model reports to the user. A non-agent caller has
 * no owning session and is rejected. Named exports preserve loader injection metadata.
 * @module @deepseek-ai/dsh-tool-fleet
 */

import type { Context } from '@deepseek-ai/cordis'
import { isAbsolute, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FleetFanoutId, FleetSnapshot } from '@deepseek-ai/dsh-fleet'
import type { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'tool-fleet'
export const inject = ['tools', 'fleet']

/** Tool configuration. */
export interface Config {
  /** Byte cap for one attempt's diff text returned by `fleet_diff`; longer diffs keep the head with a marker. */
  maxDiffBytes: number
}

/** Schemastery configuration for the fleet tool consumer. */
export const Config: z<Config> = z.object({
  maxDiffBytes: z.number().default(16_384),
})

/**
 * Truncate one string to a UTF-8 byte budget, cutting only on a code-point boundary.
 * @param text - the complete diff text.
 * @param maxBytes - inclusive byte budget.
 * @returns the head of `text` within the budget, with a marker when truncation happened.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text)
  if (bytes.byteLength <= maxBytes) return text
  let cut = maxBytes
  // Skip back over continuation bytes so the cut does not split one code point.
  while (cut > 0) {
    const byte = bytes[cut]
    if (byte === undefined || (byte & 0xc0) !== 0x80) break
    cut--
  }  return `${bytes.subarray(0, cut).toString('utf8')}\n[truncated ${String(bytes.byteLength - cut)} of ${String(bytes.byteLength)} bytes]`
}

/** One member row shared by the fanout and status outputs. */
function memberRow(member: FleetSnapshot['members'][number]): { sessionId: string; branch: string; worktreePath: string; state: string } {
  return { sessionId: member.sessionId, branch: member.branch, worktreePath: member.worktreePath, state: member.state }
}

/** The owning agent of a tool execution, or a loud rejection for a non-agent caller. */
function ownerOf(exec: { agent?: Agent }): Agent {
  if (!exec.agent) throw new Error('fleet tools require an owning agent session')
  return exec.agent
}

/**
 * Register the five fleet tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool and fleet services.
 * @param config - deployment's diff budget.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'fleet_fanout',
    description:
      'Start N parallel attempts on one task, each in its own git worktree branched from the same base: '
      + 'every attempt is a separate session receiving the same prompt, and you are notified when each finishes. '
      + 'Use for genuinely uncertain, independent tries of the same goal where comparing results adds value '
      + '(alternative implementations, competing fixes). Skip it for trivial or sequential work. Track the '
      + 'fanout id and member session ids; observe with fleet_status, compare with fleet_diff, then merge '
      + 'exactly one winner with fleet_merge and remove the fanout with fleet_cleanup.',
    parameters: {
      repo_path: { type: 'string', required: true, description: 'Path of the repository the attempts branch from; relative paths resolve from your session cwd.' },
      count: { type: 'integer', required: true, description: 'Number of parallel attempts (at least 1).' },
      prompt: { type: 'string', required: true, description: 'The task every attempt receives verbatim; one self-contained instruction performs best.' },
      base_ref: { type: 'string', description: 'Base committish for every attempt branch (default: the repository HEAD).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fanout: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              id: { type: 'string', required: true },
              repoPath: { type: 'string', required: true },
              baseRef: { type: 'string', required: true },
              baseSha: { type: 'string', required: true },
              members: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    sessionId: { type: 'string', required: true },
                    branch: { type: 'string', required: true },
                    worktreePath: { type: 'string', required: true },
                    state: { type: 'string', required: true },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Started fleet ${value.fanout.id}: ${String(value.fanout.members.length)} attempt(s) from ${value.fanout.baseRef}.`,
      }],
    },
    execute(args, exec) {
      const owner = ownerOf(exec)
      // A relative repo_path resolves from the owning session's cwd — the
      // natural anchor for a model answering about the repository it works in.
      const repoPath = isAbsolute(args.repo_path)
        ? args.repo_path
        : resolve(owner.session.header.cwd ?? process.cwd(), args.repo_path)
      return ctx.fleet.fanout({
        repoPath,
        count: args.count,
        prompt: args.prompt,
        ...args.base_ref === undefined ? {} : { baseRef: args.base_ref },
      }, owner).then(snapshot => ({
        fanout: {
          id: snapshot.id,
          repoPath: snapshot.repoPath,
          baseRef: snapshot.baseRef,
          baseSha: snapshot.baseSha,
          members: snapshot.members.map(memberRow),
        },
      }))
    },
    presentCall: args => ({ card: 'generic', title: 'Start worktree fleet', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_status',
    description:
      'List your worktree fleets with each attempt\'s live state (starting, running, idle, gone), or read one '
      + 'fanout by id. Collect every fleet\'s status before giving a final answer.',
    parameters: {
      fanout_id: { type: 'string', description: 'Restrict the answer to one fanout id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fanouts: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                mergedSessionId: { type: 'string' },
                members: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      sessionId: { type: 'string', required: true },
                      branch: { type: 'string', required: true },
                      worktreePath: { type: 'string', required: true },
                      state: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.fanouts.length === 0
          ? '(no fleets)'
          : value.fanouts.map(f => `${f.id}: ${f.members.map(m => `${m.sessionId} [${m.state}]`).join(', ')}`).join('\n'),
      }],
    },
    execute(args, exec) {
      const owner = ownerOf(exec)
      const snapshots = ctx.fleet.status(owner, args.fanout_id === undefined ? undefined : args.fanout_id as FleetFanoutId)
      return Promise.resolve({
        fanouts: snapshots.map(snapshot => ({
          id: snapshot.id,
          ...snapshot.mergedSessionId === undefined ? {} : { mergedSessionId: snapshot.mergedSessionId },
          members: snapshot.members.map(memberRow),
        })),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Fleet status', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_diff',
    description:
      'Diff every attempt of one fleet against the shared base commit: per member a stat summary and the '
      + 'unified diff. Compare attempts with this before choosing a winner.',
    parameters: {
      fanout_id: { type: 'string', required: true, description: 'The fanout to diff.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          members: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sessionId: { type: 'string', required: true },
                branch: { type: 'string', required: true },
                stat: { type: 'string', required: true },
                diff: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.members.map(m => `${m.sessionId} (${m.branch}):\n${m.stat}`).join('\n\n'),
      }],
    },
    execute(args, exec) {
      const owner = ownerOf(exec)
      return ctx.fleet.diff(owner, args.fanout_id as FleetFanoutId).then(diffs => ({
        members: diffs.map(member => ({
          sessionId: member.sessionId,
          branch: member.branch,
          stat: member.diff.stat.trim() === '' ? '(no changes)' : member.diff.stat.trim(),
          diff: truncateUtf8(member.diff.diff, config.maxDiffBytes),
        })),
      }))
    },
    presentCall: args => ({ card: 'generic', title: 'Show fleet diffs', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_merge',
    description:
      'Merge exactly one finished attempt\'s branch into the base repository\'s current HEAD. The attempt '
      + 'must not be running. A conflicting merge is aborted and reported — resolve conflicts yourself in '
      + 'the base repository, then retry.',
    parameters: {
      fanout_id: { type: 'string', required: true, description: 'The fanout holding the attempt.' },
      session_id: { type: 'string', required: true, description: 'The winning attempt\'s session id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['merged', 'up-to-date', 'conflict', 'error'] },
          output: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `fleet merge: ${value.status}` }],
    },
    execute(args, exec) {
      const owner = ownerOf(exec)
      return ctx.fleet.merge(owner, args.fanout_id as FleetFanoutId, args.session_id as SessionId)
    },
    presentCall: args => ({ card: 'generic', title: 'Merge fleet winner', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_cleanup',
    description:
      'Remove one fleet after its winner is merged (or its attempts stopped mattering): stops member '
      + 'agents, deletes their worktrees and branches, and unregisters their workspaces. Persisted member '
      + 'sessions stay readable.',
    parameters: {
      fanout_id: { type: 'string', required: true, description: 'The fanout to remove.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          removed: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Removed fleet ${value.removed}` }],
    },
    execute(args, exec) {
      const owner = ownerOf(exec)
      return ctx.fleet.cleanup(owner, args.fanout_id as FleetFanoutId).then(() => ({ removed: args.fanout_id }))
    },
    presentCall: args => ({ card: 'generic', title: 'Clean up fleet', kind: 'other', rawInput: args }),
  }))
}
