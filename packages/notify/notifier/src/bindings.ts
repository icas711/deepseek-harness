/**
 * Durable login-to-destination bindings: the bindings document, its strict
 * boundary parse, and the merge-under-lock write. Binding records are never
 * deleted, so a write re-reads the document under the cross-process writer
 * lock and merges by login: two processes sharing a harness home cannot lose
 * each other's bindings.
 * @module @deepseek-ai/dsh-notifier/bindings
 */

import { readFile } from 'node:fs/promises'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { ChatId } from './brand.ts'
import type { BindingRecord } from './types.ts'

/** On-disk format version, stamped into every document and enforced on load. */
export const BINDINGS_FORMAT_VERSION = 1

/** Logins double as keys in the durable document; they stay plain short segments. */
export const LOGIN_PATTERN = /^\S{1,128}$/

/** Whether a filesystem error means absence; every other failure surfaces. */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * The bindings document failed its boundary parse. Rendered as a boot failure
 * with operator guidance: a corrupt durable binding store must fail loud,
 * never be silently ignored or overwritten.
 */
export class BindingFileError extends Error {
  /**
   * Construct one parse failure.
   * @param filePath - the document that failed to parse.
   * @param reason - the concrete validation failure.
   */
  constructor(filePath: string, reason: string) {
    super(`notifier: cannot read the bindings document "${filePath}" (${reason}); `
      + 'fix or delete the file — deleting it unbinds every user')
    this.name = 'BindingFileError'
  }
}

/** On-disk document shape. */
interface BindingsDocument {
  version: typeof BINDINGS_FORMAT_VERSION
  bindings: BindingRecord[]
}

/**
 * Parse one bindings document at the durable boundary. Every field is
 * validated; non-records and a foreign version fail loud.
 * @param text - complete file content.
 * @param filePath - the document path, named in failures.
 * @returns the parsed binding records.
 * @throws {@link BindingFileError} on any structural violation.
 */
export function parseBindingsDocument(text: string, filePath: string): BindingRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new BindingFileError(filePath, `not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BindingFileError(filePath, 'not a bindings document')
  }
  const doc = parsed as { version?: unknown; bindings?: unknown }
  if (doc.version !== BINDINGS_FORMAT_VERSION) {
    throw new BindingFileError(filePath, `expected version ${BINDINGS_FORMAT_VERSION}, got ${String(doc.version)}`)
  }
  if (!Array.isArray(doc.bindings)) {
    throw new BindingFileError(filePath, 'bindings must be an array')
  }
  return doc.bindings.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new BindingFileError(filePath, `bindings[${index}] is not a record`)
    }
    const record = entry as { login?: unknown; chatId?: unknown; boundAt?: unknown }
    if (typeof record.login !== 'string' || !LOGIN_PATTERN.test(record.login)) {
      throw new BindingFileError(filePath, `bindings[${index}] carries a malformed login`)
    }
    if (typeof record.chatId !== 'string' || record.chatId === '') {
      throw new BindingFileError(filePath, `bindings[${index}] carries a malformed chatId`)
    }
    if (typeof record.boundAt !== 'number' || !Number.isSafeInteger(record.boundAt)) {
      throw new BindingFileError(filePath, `bindings[${index}] carries a non-integer boundAt`)
    }
    return { login: record.login, chatId: ChatId(record.chatId), boundAt: record.boundAt }
  })
}

/**
 * Render the complete next document. Two-space indentation keeps the file
 * human-diffable; the trailing newline matches the repository file gate.
 * @param bindings - every record in the store's order.
 * @returns the complete file content to commit.
 */
export function serializeBindingsDocument(bindings: readonly BindingRecord[]): string {
  const doc: BindingsDocument = { version: BINDINGS_FORMAT_VERSION, bindings: [...bindings] }
  return `${JSON.stringify(doc, null, 2)}\n`
}

/** In-process store over the durable bindings document. */
export class BindingStore {
  private readonly records = new Map<string, BindingRecord>()

  /**
   * Construct the store.
   * @param filePath - durable document path; a composition passes
   * `dshHomePath('telegram-bindings.json')` (the deployed document name).
   */
  constructor(private readonly filePath: string) {}

  /**
   * Load the document into memory; an absent document is an empty store, a
   * corrupt one fails loud.
   */
  async load(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (!isENOENT(error)) throw error
      return
    }
    for (const record of parseBindingsDocument(text, this.filePath)) {
      this.records.set(record.login, record)
    }
  }

  /**
   * @param login - the user to look up.
   * @returns the binding record, or undefined while unbound.
   */
  get(login: string): BindingRecord | undefined {
    return this.records.get(login)
  }

  /**
   * @returns the logins that currently hold a binding, in document order.
   */
  logins(): string[] {
    return [...this.records.keys()]
  }

  /**
   * Confirm one binding durably: re-read the document under the writer lock,
   * merge the new record by login (a re-binding overwrites), adopt the merged
   * state, and commit it atomically. The file holds user-private data, so it
   * is written owner-only (0600, parent 0700).
   * @param login - the user to bind.
   * @param chatId - the confirmed destination id.
   * @returns the committed record.
   */
  async bind(login: string, chatId: string): Promise<BindingRecord> {
    const record: BindingRecord = { login, chatId: ChatId(chatId), boundAt: Date.now() }
    await withFileLock(this.filePath, async () => {
      const merged = new Map<string, BindingRecord>()
      let text: string | undefined
      try {
        text = await readFile(this.filePath, 'utf8')
      } catch (error) {
        if (!isENOENT(error)) throw error
      }
      if (text !== undefined) {
        for (const existing of parseBindingsDocument(text, this.filePath)) {
          merged.set(existing.login, existing)
        }
      }
      merged.set(login, record)
      await writeFileAtomic(this.filePath, serializeBindingsDocument([...merged.values()]), {
        mode: 0o600,
        dirMode: 0o700,
      })
      this.records.clear()
      for (const entry of merged.values()) this.records.set(entry.login, entry)
    })
    return record
  }
}
