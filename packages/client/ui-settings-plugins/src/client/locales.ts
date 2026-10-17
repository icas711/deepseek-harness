/** Locale bundles for the plugin configuration section and its plugin cards. */

/** Locale keys these surfaces render. */
export type PluginsSettingsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'configurableTab' | 'empty'
  | 'overridden' | 'reset' | 'readOnly' | 'expand' | 'collapse'
  | 'save' | 'saving' | 'discard' | 'unsaved' | 'saveFailed' | 'invalidNumber'
  | 'apiKeyLabel' | 'apiKeyHint' | 'apiKeySet' | 'apiKeyUnset'
  | 'bashTitle' | 'bashDescription' | 'bashTimeoutMs' | 'bashTimeoutMsHint'
  | 'bashMaxOutputBytes' | 'bashMaxOutputBytesHint'
  | 'agentLoopTitle' | 'agentLoopDescription' | 'agentLoopMaxParallel' | 'agentLoopMaxParallelHint'
  | 'webAccessTitle' | 'webAccessDescription' | 'webAccessSearchGroup' | 'webAccessFetchGroup'
  | 'webAccessAuto' | 'webAccessNotMounted' | 'webAccessKeyMissing' | 'webAccessAmbiguous'
  | 'webProviderDeepSeek' | 'webProviderZai' | 'webProviderExa' | 'webProviderPerplexity' | 'webProviderHttp'
  | 'webSearchTitle' | 'webSearchDescription'
  | 'webSearchBaseUrl' | 'webSearchBaseUrlHint' | 'webSearchMaxUses' | 'webSearchMaxUsesHint'
  | 'zaiTitle' | 'zaiDescription' | 'zaiBaseUrl' | 'zaiBaseUrlHint' | 'zaiSearchEngine' | 'zaiSearchEngineHint'
  | 'zaiCount' | 'zaiCountHint'
  | 'exaTitle' | 'exaDescription' | 'exaBaseUrl' | 'exaBaseUrlHint' | 'exaSearchType' | 'exaSearchTypeHint'
  | 'exaNumResults' | 'exaNumResultsHint' | 'exaHighlights' | 'exaHighlightsHint'
  | 'perplexityTitle' | 'perplexityDescription' | 'perplexityBaseUrl' | 'perplexityBaseUrlHint'
  | 'perplexityModel' | 'perplexityModelHint' | 'perplexityMaxTokens' | 'perplexityMaxTokensHint'
  | 'perplexitySearchRecency' | 'perplexitySearchRecencyHint'
  | 'webFetchTitle' | 'webFetchDescription'
  | 'webFetchMaxUrlLength' | 'webFetchMaxUrlLengthHint' | 'webFetchMaxResponseBytes' | 'webFetchMaxResponseBytesHint'
  | 'webFetchMaxBodyChars' | 'webFetchMaxBodyCharsHint' | 'webFetchTimeoutMs' | 'webFetchTimeoutMsHint'
  | 'webFetchMaxRedirects' | 'webFetchMaxRedirectsHint' | 'webFetchUserAgent' | 'webFetchUserAgentHint'

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
  apiKeyLabel: 'API-ключ',
  apiKeyHint: 'Хранится вне файла настроек. Оставьте пустым, чтобы сохранить текущий ключ.',
  apiKeySet: 'Ключ настроен.',
  apiKeyUnset: 'Ключ не настроен; до его настройки провайдер недоступен.',
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
  webAccessTitle: 'Веб-доступ',
  webAccessDescription: 'Какой плагин выполняет поиск и загрузку страниц.',
  webAccessSearchGroup: 'Поиск',
  webAccessFetchGroup: 'Загрузка страниц',
  webAccessAuto: 'Авто',
  webAccessNotMounted: 'плагин не подключён',
  webAccessKeyMissing: 'У выбранного провайдера не настроен ключ API — до настройки он недоступен.',
  webAccessAmbiguous: 'В режиме «Авто» пригодны несколько провайдеров поиска, и запрос вернёт ошибку. Выберите провайдера явно.',
  webProviderDeepSeek: 'DeepSeek',
  webProviderZai: 'Z.ai',
  webProviderExa: 'Exa',
  webProviderPerplexity: 'Perplexity',
  webProviderHttp: 'HTTP',
  webSearchTitle: 'Веб-поиск',
  webSearchDescription: 'Провайдер поиска DeepSeek.',
  webSearchBaseUrl: 'Адрес эндпоинта',
  webSearchBaseUrlHint: 'Оставьте пустым, чтобы использовать адрес провайдера по умолчанию.',
  webSearchMaxUses: 'Максимум поисков за запрос',
  webSearchMaxUsesHint: 'Сколько раз один запрос может выполнять поиск, прежде чем дать ответ.',
  zaiTitle: 'Веб-поиск Z.ai',
  zaiDescription: 'Провайдер поиска Z.ai.',
  zaiBaseUrl: 'Адрес эндпоинта',
  zaiBaseUrlHint: 'Оставьте пустым, чтобы использовать адрес провайдера по умолчанию.',
  zaiSearchEngine: 'Поисковый движок',
  zaiSearchEngineHint: 'Какой движок Z.ai выполняет поиск.',
  zaiCount: 'Результатов по умолчанию',
  zaiCountHint: 'Сколько результатов возвращать, когда запрос не задаёт лимит.',
  exaTitle: 'Веб-поиск Exa',
  exaDescription: 'Провайдер поиска Exa.',
  exaBaseUrl: 'Адрес эндпоинта',
  exaBaseUrlHint: 'Оставьте пустым, чтобы использовать адрес провайдера по умолчанию.',
  exaSearchType: 'Тип поиска',
  exaSearchTypeHint: 'auto, keyword или neural — как Exa выбирает документы.',
  exaNumResults: 'Результатов по умолчанию',
  exaNumResultsHint: 'Сколько результатов возвращать, когда запрос не задаёт лимит.',
  exaHighlights: 'Цитат на результат',
  exaHighlightsHint: 'Сколько выдержек из каждого документа возвращать.',
  perplexityTitle: 'Веб-поиск Perplexity',
  perplexityDescription: 'Провайдер поиска Perplexity.',
  perplexityBaseUrl: 'Адрес эндпоинта',
  perplexityBaseUrlHint: 'Оставьте пустым, чтобы использовать адрес провайдера по умолчанию.',
  perplexityModel: 'Модель',
  perplexityModelHint: 'Какая модель Perplexity выполняет поиск.',
  perplexityMaxTokens: 'Лимит токенов ответа',
  perplexityMaxTokensHint: 'Сколько токенов ответа может занять один поиск.',
  perplexitySearchRecency: 'Свежесть результатов',
  perplexitySearchRecencyHint: 'day, week, month или year — насколько свежие документы искать.',
  webFetchTitle: 'Загрузка страниц',
  webFetchDescription: 'Ограничения провайдера загрузки HTTP-страниц.',
  webFetchMaxUrlLength: 'Максимальная длина URL',
  webFetchMaxUrlLengthHint: 'Более длинные адреса отклоняются до запроса.',
  webFetchMaxResponseBytes: 'Лимит ответа (байт)',
  webFetchMaxResponseBytesHint: 'Ответы больше этого лимита отклоняются.',
  webFetchMaxBodyChars: 'Лимит тела (символы)',
  webFetchMaxBodyCharsHint: 'Тело ответа обрезается до этого размера перед возвратом.',
  webFetchTimeoutMs: 'Таймаут загрузки (мс)',
  webFetchTimeoutMsHint: 'Сколько времени может занимать одна загрузка.',
  webFetchMaxRedirects: 'Максимум перенаправлений',
  webFetchMaxRedirectsHint: 'Сколько перенаправлений может пройти одна загрузка.',
  webFetchUserAgent: 'User-Agent',
  webFetchUserAgentHint: 'Строка User-Agent, которую провайдер отправляет с каждым запросом.',
}
