/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-13.1'

/** The complete editable internal-testing notice (the GUI is Russian-only). */
export const WELCOME_NOTICE_COPY = {
  title: 'Уведомление о внутреннем тестировании',
  body: 'DeepSeek Harness 0.1 находится на стадии тестирования разработчиками Harness. Многое ещё предстоит улучшить, и мы ждём отзывов от сообщества разработчиков. Базовые плагины и фундаментальные API DeepSeek Harness будут быстро развиваться и в ближайшие месяцы.\n\nМы ждём разработчиков со всего мира, чтобы вместе исследовать пределы интеллекта на открытой, переиспользуемой и компонуемой инфраструктуре. Присоединяйтесь к экосистеме плагинов DSH.',
  continueLabel: 'Продолжить',
} as const
