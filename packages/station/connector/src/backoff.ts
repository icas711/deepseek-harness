/**
 * Политика переподключения коннектора: экспоненциальная задержка с
 * джиттером, ограниченная сверху. Чистая функция — отдельно проверяется
 * юнит-тестами; таймеров сама не держит.
 * @module @deepseek-ai/dsh-station-connector/backoff
 */

/** Первая задержка после разрыва. */
export const RECONNECT_INITIAL_MS = 1_000
/** Верхняя граница задержки: дальше не растёт. */
export const RECONNECT_MAX_MS = 30_000
/** Относительный джиттер ±20%, чтобы рой коннекторов не бил волнами. */
const JITTER = 0.2

/**
 * Задержка перед попыткой №`attempt` (0 — сразу после первого разрыва).
 * @param attempt - номер попытки, начиная с 0.
 * @param random - источник джиттера; по умолчанию Math.random.
 * @returns задержка в миллисекундах, от initial/2 до max.
 */
export function nextBackoffMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(RECONNECT_INITIAL_MS * 2 ** Math.max(0, attempt), RECONNECT_MAX_MS)
  const jittered = exponential * (1 - JITTER + random() * 2 * JITTER)
  return Math.max(250, Math.round(jittered))
}
