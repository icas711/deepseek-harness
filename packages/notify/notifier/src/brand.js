/**
 * Branding constructors for the notifier's opaque cross-boundary ids.
 * @module @deepseek-ai/dsh-notifier/brand
 */
/** Brand a raw string as a {@link ChatId}.
 * @param value - the raw destination id string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function ChatId(value) {
    return value;
}
/** Brand a raw string as a {@link BindingCode}.
 * @param value - the raw code string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function BindingCode(value) {
    return value;
}
//# sourceMappingURL=brand.js.map