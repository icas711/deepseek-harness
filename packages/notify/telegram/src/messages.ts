/**
 * User-facing bot texts: Russian constants and the notification text
 * formatter. The snapshot suite pins every literal verbatim.
 * @module @deepseek-ai/dsh-telegram-notifier/messages
 */

import type { NotificationKind } from '@deepseek-ai/dsh-notifier'

/** Headline per notification kind; the map is exhaustive over the seam’s closed union. */
const HEADLINES: Record<NotificationKind, string> = {
  paused: 'Требуется действие: задача приостановлена',
  interrupted: 'Требуется действие: задача прервана сбоем',
  completed: 'Задача завершена',
  failed: 'Задача провалена',
}

/** Tail of the reply a chat gets after presenting a valid pairing code. */
export const BINDING_CONFIRMED_TAIL = 'привязан: уведомления о задачах будут приходить в этот чат.'

/** Reply when the presented code is unknown, consumed, or expired. */
export const BINDING_REJECTED_TEXT = 'Код не найдён или истёк. Запросите новый код сопряжения и отправьте /start КОД ещё раз.'

/** Reply to a chat whose message is not "/start КОД". */
export const BINDING_HINT_TEXT = 'Отправьте /start КОД, где КОД — код сопряжения, полученный в DSH.'

/** Reply when the code was valid but the binding could not be committed. */
export const BINDING_FAILED_TEXT = 'Не удалось сохранить привязку. Попробуйте ещё раз.'

/**
 * Compose the confirmation for one bound login.
 * @param login - the login the confirmed code was minted for.
 * @returns the full confirmation text.
 */
export function bindingConfirmedText(login: string): string {
  return `Аккаунт «${login}» ${BINDING_CONFIRMED_TAIL}`
}

/**
 * Build the session link from the deployment’s base URL.
 * @param webBaseUrl - the base URL (usually `DSH_WEB_URL`); blank counts as absent.
 * @param sessionId - the session to link to.
 * @returns the absolute link, or undefined when no base URL is configured.
 */
export function formatSessionLink(webBaseUrl: string | undefined, sessionId: string): string | undefined {
  const base = webBaseUrl?.trim()
  if (base === undefined || base === '') return undefined
  return `${base.replace(/\/+$/, '')}/session/${sessionId}`
}

/**
 * Compose one notification text: the headline, the task title, and — when a
 * base URL is configured — the session link. Nothing else enters the text.
 * @param request - the notification content.
 * @param webBaseUrl - the deployment’s base URL, when known.
 * @returns the complete message text.
 */
export function formatTaskText(
  request: { kind: NotificationKind; title: string; sessionId: string },
  webBaseUrl: string | undefined,
): string {
  const link = formatSessionLink(webBaseUrl, request.sessionId)
  const head = `${HEADLINES[request.kind]}\n\nЗадача: «${request.title}»`
  return link === undefined ? head : `${head}\nОткрыть сессию: ${link}`
}
