/**
 * Durable login-to-destination bindings: the bindings document, its strict
 * boundary parse, and the merge-under-lock write. Binding records are never
 * deleted, so a write re-reads the document under the cross-process writer
 * lock and merges by login: two processes sharing a harness home cannot lose
 * each other's bindings.
 * @module @deepseek-ai/dsh-notifier/bindings
 */
import type { BindingRecord } from './types.ts';
/** On-disk format version, stamped into every document and enforced on load. */
export declare const BINDINGS_FORMAT_VERSION = 1;
/** Logins double as keys in the durable document; they stay plain short segments. */
export declare const LOGIN_PATTERN: RegExp;
/**
 * The bindings document failed its boundary parse. Rendered as a boot failure
 * with operator guidance: a corrupt durable binding store must fail loud,
 * never be silently ignored or overwritten.
 */
export declare class BindingFileError extends Error {
    /**
     * Construct one parse failure.
     * @param filePath - the document that failed to parse.
     * @param reason - the concrete validation failure.
     */
    constructor(filePath: string, reason: string);
}
/**
 * Parse one bindings document at the durable boundary. Every field is
 * validated; non-records and a foreign version fail loud.
 * @param text - complete file content.
 * @param filePath - the document path, named in failures.
 * @returns the parsed binding records.
 * @throws {@link BindingFileError} on any structural violation.
 */
export declare function parseBindingsDocument(text: string, filePath: string): BindingRecord[];
/**
 * Render the complete next document. Two-space indentation keeps the file
 * human-diffable; the trailing newline matches the repository file gate.
 * @param bindings - every record in the store's order.
 * @returns the complete file content to commit.
 */
export declare function serializeBindingsDocument(bindings: readonly BindingRecord[]): string;
/** In-process store over the durable bindings document. */
export declare class BindingStore {
    private readonly filePath;
    private readonly records;
    /**
     * Construct the store.
     * @param filePath - durable document path; a composition passes
     * `dshHomePath('telegram-bindings.json')` (the deployed document name).
     */
    constructor(filePath: string);
    /**
     * Load the document into memory; an absent document is an empty store, a
     * corrupt one fails loud.
     */
    load(): Promise<void>;
    /**
     * @param login - the user to look up.
     * @returns the binding record, or undefined while unbound.
     */
    get(login: string): BindingRecord | undefined;
    /**
     * @returns the logins that currently hold a binding, in document order.
     */
    logins(): string[];
    /**
     * Confirm one binding durably: re-read the document under the writer lock,
     * merge the new record by login (a re-binding overwrites), adopt the merged
     * state, and commit it atomically. The file holds user-private data, so it
     * is written owner-only (0600, parent 0700).
     * @param login - the user to bind.
     * @param chatId - the confirmed destination id.
     * @returns the committed record.
     */
    bind(login: string, chatId: string): Promise<BindingRecord>;
}
//# sourceMappingURL=bindings.d.ts.map