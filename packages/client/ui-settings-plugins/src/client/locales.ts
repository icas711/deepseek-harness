/** Locale bundles for the plugin configuration section and its plugin cards. */

/** Locale keys these surfaces render. */
export type PluginsSettingsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'configurableTab' | 'empty'
  | 'overridden' | 'reset' | 'readOnly' | 'expand' | 'collapse'
  | 'save' | 'saving' | 'discard' | 'unsaved' | 'saveFailed' | 'invalidNumber'
  | 'bashTitle' | 'bashDescription' | 'bashTimeoutMs' | 'bashTimeoutMsHint'
  | 'bashMaxOutputBytes' | 'bashMaxOutputBytesHint'
  | 'agentLoopTitle' | 'agentLoopDescription' | 'agentLoopMaxParallel' | 'agentLoopMaxParallelHint'
  | 'webSearchTitle' | 'webSearchDescription'
  | 'webSearchApiKey' | 'webSearchApiKeyHint' | 'webSearchApiKeySet' | 'webSearchApiKeyUnset'
  | 'webSearchBaseUrl' | 'webSearchBaseUrlHint' | 'webSearchMaxUses' | 'webSearchMaxUsesHint'

/** Russian dictionary, checked complete against the key union. */
export const ru: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Плагины',
  title: 'Плагины',
  intro: 'Настройка и просмотр плагинов, установленных в этом развертывании.',
  tabs: 'Разделы плагинов',
  configurableTab: 'Конфигурация плагинов',
  empty: 'Это развертывание не предоставляет настроек плагинов.',
  overridden: 'Переопределено',
  reset: 'Сбросить по умолчанию',
  readOnly: 'Это развертывание хранит настройки в режиме только для чтения.',
  expand: 'Показать настройки',
  collapse: 'Скрыть настройки',
  save: 'Сохранить',
  saving: 'Сохранение…',
  discard: 'Отменить изменения',
  unsaved: 'Не сохранено',
  saveFailed: 'Развертывание не приняло эти значения; они оставлены, чтобы вы могли их исправить.',
  invalidNumber: 'Введите число или оставьте поле пустым, чтобы использовать значение по умолчанию.',
  bashTitle: 'Shell',
  bashDescription: 'Ограничивает каждую команду, которую запускает агент.',
  bashTimeoutMs: 'Таймаут команды (мс)',
  bashTimeoutMsHint: 'Сколько времени может выполняться одна команда, прежде чем она будет завершена.',
  bashMaxOutputBytes: 'Лимит вывода на поток (байт)',
  bashMaxOutputBytesHint: 'Вывод сверх этого лимита сохраняется во временный файл, а не теряется.',
  agentLoopTitle: 'Цикл агента',
  agentLoopDescription: 'Как агент отправляет вызовы инструментов.',
  agentLoopMaxParallel: 'Параллельные вызовы инструментов',
  agentLoopMaxParallelHint: 'Верхний предел одновременных безопасных для параллельного выполнения вызовов в рамках одного шага.',
  webSearchTitle: 'Веб-поиск',
  webSearchDescription: 'Провайдер поиска DeepSeek.',
  webSearchApiKey: 'API-ключ',
  webSearchApiKeyHint: 'Хранится вне файла настроек. Оставьте пустым, чтобы сохранить текущий ключ.',
  webSearchApiKeySet: 'Ключ настроен.',
  webSearchApiKeyUnset: 'Ключ не настроен; до его настройки поиск недоступен.',
  webSearchBaseUrl: 'Адрес эндпоинта',
  webSearchBaseUrlHint: 'Оставьте пустым, чтобы использовать адрес провайдера по умолчанию.',
  webSearchMaxUses: 'Максимум поисков за запрос',
  webSearchMaxUsesHint: 'Сколько раз один запрос может выполнять поиск, прежде чем дать ответ.',
}
