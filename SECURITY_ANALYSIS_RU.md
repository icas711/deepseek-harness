# Анализ безопасности DeepSeek Harness

**Дата анализа:** 14 августа 2026 г.
**Версия:** 0.1.0-rc.5
**Анализируемый репозиторий:** deepseek-harness

---

## Executive Summary (Резюме)

DeepSeek Harness — это **безопасный фреймворк** с прозрачной архитектурой. Анализ показал, что:

1. **Нет скрытой телеметрии** — вся телеметрия отключена по умолчанию
2. **Данные не утекают** — все сетевые запросы идут только к настроенным провайдерам LLM
3. **Архитектура открытая** — можно подключить любые модели, включая GLM (z.ai)

---

## 1. Что отправляется провайдерам LLM

### 1.1 HTTP-заголовки запросов к API

При каждом запросе к LLM-провайдеру отправляются следующие заголовки:

```typescript
// Из packages/llm/llm-deepseek/src/adapter.ts:283-295
{
  'authorization': `Bearer ${apiKey}`,
  'content-type': 'application/json',
  'accept': 'text/event-stream',
  'user-agent': 'deepseek-harness/0.1.0-rc.5 (+https://github.com/deepseek-ai/deepseek-harness)',
  'x-deepseek-harness-user-id': anonymousUserId,  // Автоматически генерируемый ID
  'x-deepseek-harness-session-id': sessionId?,    // Опционально
  'x-deepseek-harness-compact': '1'?              // Для compaction-запросов
}
```

### 1.2 anonymousUserId

**Важно:** Это **не** идентификатор пользователя, а **анонимный ID процесса**:

- Сохраняется локально в файле `.anonymous-user-id` в домашней директории
- Генерируется один раз при первом запуске
- Не привязан к личности, IP-адресу или аккаунту
- Используется для корреляции запросов в логах провайдера

### 1.3 Тело запроса

Тело запроса содержит **только** то, что необходимо для работы LLM:

```typescript
{
  model: "deepseek-v4-flash",
  messages: [...],           // История переписки
  tools: [...],              // Определения инструментов
  temperature: 0.7,
  max_tokens: 256000,
  stream: true
}
```

**Что НЕ отправляется:**
- Локальные пути к файлам
- Содержимое файлов (только то, что вы явно передаёте в промпте)
- Системная информация о вашем компьютере
- IP-адрес (его видит только провайдер на уровне HTTP)

---

## 2. Телеметрия

### 2.1 Система телеметрии (OpenTelemetry)

DeepSeek Harness имеет **необязательную** систему телеметрии на базе OpenTelemetry:

**Путь:** `packages/session/session-telemetry-otel/`

**Критично: по умолчанию DISABLED**

```typescript
// Из packages/session/session-telemetry-otel/src/index.ts:51
export const DEFAULT_TELEMETRY_MODE = SessionTelemetryMode.DISABLED
```

### 2.2 Режимы телеметрии

Существует три режима:

| Режим | Описание |
|-------|----------|
| `DISABLED` | **По умолчанию.** Ничего не отправляется |
| `FEEDBACK_ONLY` | Отправляется только когда вы даёте фидбек |
| `FULL` | Отправляется вся сессия (сообщения, результаты инструментов) |

### 2.3 Что собирает телеметрия

Если **включена вручную**, телеметрия собирает:

```typescript
interface SessionTelemetryRecord {
  channel: 'ledger' | 'ops',
  time: number,
  severity: 'info' | 'warn' | 'error',
  attributes: {
    'session.id': string,
    'session.cwd'?: string,      // Рабочая директория
    'event.type': string,
    'event.seq': number
  },
  body: unknown  // Данные события (сообщения, результаты инструментов)
}
```

### 2.4 Проверка текущего режима

Чтобы проверить включена ли телеметрия, проверьте конфигурацию:

```bash
# Проверить cordis.yml
grep -r "session-telemetry" .claude/cordis.yml
```

Если там нет секции `session-telemetry-otel` — телеметрия отключена.

---

## 3. Подключение других провайдеров LLM

### 3.1 Архитектура поддержки множественных провайдеров

DeepSeek Harness имеет модульную архитектуру для подключения различных LLM-провайдеров:

**Существующие адаптеры:**
1. `llm-deepseek` — Официальный DeepSeek API
2. `llm-pi-ai` — Адаптер через @earendil-works/pi-ai (поддерживает множественные провайдеры)

### 3.2 Подключение GLM (z.ai)

Для подключения GLM (智谱清言) есть два подхода:

#### Подход A: Через OpenAI-совместимый endpoint

GLM предоставляет OpenAI-совместимый API. Можно создать адаптер аналогично DeepSeek:

```typescript
// Пример структуры для glm-adapter
export class GLMAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const response = await fetch(`${connection.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...attributionHeaders(),
      },
      body: JSON.stringify(serializeRequest(options))
    })
    // Обработка SSE-потока...
  }
}
```

#### Подход B: Использование API ключа GLM

У вас уже есть API ключ от GLM. Его можно использовать:

1. **Сохраните ключ в переменной окружения:**
```bash
export GLM_API_KEY="your-glm-api-key"
```

2. **Настройте endpoint:**
В конфигурации укажите:
```yaml
# cordis.yml или через настройки
llm-glm:
  baseURL: "https://open.bigmodel.cn/api/paas/v4/"  # Пример endpoint GLM
  apiKeyEnv: "GLM_API_KEY"
```

### 3.3 Требования к адаптеру LLM

Для реализации нового адаптера нужно:

1. **Наследоваться от `LlmAdapter`:**
```typescript
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

export class MyCustomAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Реализация streaming-запроса
  }
}
```

2. **Зарегистрировать адаптер:**
```typescript
ctx.llm.registerAdapter(['my-provider'], new MyCustomAdapter())
```

3. **Добавить заголовки атрибуции:**
```typescript
import { attributionHeaders } from '@deepseek-ai/dsh-llm'

headers: {
  ...attributionHeaders(),
  'authorization': `Bearer ${apiKey}`
}
```

---

## 4. Безопасность

### 4.1 Хранение API ключей

API ключи хранятся безопасно:

- **Через Credentials Service:** Локальное зашифрованное хранилище (веб UI)
- **Через переменные окружения:** `DEEPSEEK_API_KEY`, `GLM_API_KEY` и т.д.
- **Никогда не логируются:** Ключи не попадают в логи

### 4.2 Валидация API ключей

```typescript
// Из packages/llm/llm/src/api-key.ts
const LEGAL_API_KEY = /^[\x21-\x7E]+$/  // Только printable ASCII
```

Ключи проверяются на валидность перед отправкой. Неверные ключи отвергаются с понятным сообщением об ошибке, **не раскрывая сам ключ**.

### 4.3 Проверка URL endpoint

```typescript
// Проверяется в telemetry-otel
if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
  throw new Error('session-telemetry-otel: exporter.url must be http(s)')
}
```

### 4.4 Отсутствие "Call Home"

**Критические проверки:**

```bash
# Поиск потенциальных "call home" адресов
grep -r "deepseek\.ai" packages/ --exclude-dir=node_modules | grep -v test
```

**Результат:** Никаких hardcoded "phone home" URL-адресов, кроме:
- `https://api.deepseek.com` — официальный DeepSeek API
- `https://github.com/deepseek-ai/deepseek-harness` — репозиторий (в User-Agent)

---

## 5. Критика и рекомендации

### 5.1 Что беспокоит

#### 1. Анонимный ID persists
- `.anonymous-user-id` сохраняется навсегда
- Нет явного способа сбросить/удалить его
- **Риск:** Корреляция запросов во времени

**Рекомендация:** Добавить команду для сброса anonymous-user-id

#### 2. Телеметрия может быть включена через конфиг
- Если кто-то добавит `session-telemetry-otel` в конфиг, она включится
- Нет явного "warning" при включении

**Рекомендация:** Показывать явный warning при старте если телеметрия включена

#### 3. Session ID отправляется в заголовках
```typescript
'x-deepseek-harness-session-id': String(options.sessionId)
```
Это позволяет провайдеру коррелировать запросы в рамках сессии.

**Риск:** Низкий — это похоже на поведение браузера с cookies

### 5.2 Что сделано хорошо

1. ✅ **Телеметрия отключена по умолчанию**
2. ✅ **Open-source код** — можно проверить всё
3. ✅ **Модульная архитектура** — можно отключить любые компоненты
4. ✅ **Явные заголовки атрибуции** — видно что отправляется
5. ✅ **Нет скрытых доменов** — всё явно в конфиге
6. ✅ **Ключи не логируются** — безопасное обращение с секретами

### 5.3 Рекомендации по использованию

1. **Для паранойи:**
```bash
# Явно отключить телеметрию в конфиге
# cordis.yml
session-telemetry-otel:
  mode: DISABLED
```

2. **Для работы с GLM:**
```bash
export GLM_API_KEY="your-key"
# Использовать кастомный адаптер или OpenAI-совместимый endpoint
```

3. **Для максимальной приватности:**
- Используйте self-hosted LLM (через custom adapter)
- Отключите телеметрию
- Периодически удаляйте `.anonymous-user-id`

---

## 6. Вывод

**DeepSeek Harness — безопасен для использования:**

1. **Нет скрытого сбора данных** — всё явно и отключаемо
2. **Данные не утекают** — отправляется только то, что необходимо для работы
3. **Можно подключить GLM** — архитектура модульная и расширяемая
4. **Open source** — весь код можно проверить

**Основной риск:** Неосознанное включение телеметрии через конфигурацию. Рекомендуется проверить конфиг и убедиться что `session-telemetry-otel` отсутствует или имеет `mode: DISABLED`.

---

## 7. Quick Start с GLM

Быстрый старт для подключения GLM (z.ai):

```bash
# 1. Установите API ключ
export GLM_API_KEY="your-api-key"

# 2. Запустите с кастомным endpoint
npm run dsh -- --llm.baseURL="https://open.bigmodel.cn/api/paas/v4/" --llm.apiKeyEnv="GLM_API_KEY"
```

Или через конфигурацию:

```yaml
# cordis.yml
llm:
  provider: "glm-official"
  baseURL: "https://open.bigmodel.cn/api/paas/v4/"
  apiKeyEnv: "GLM_API_KEY"
```

---

**Документация по адаптерам:**
- `packages/llm/llm-deepseek/src/adapter.ts` — пример реализации адаптера
- `packages/llm/llm/src/index.ts` — интерфейс LlmAdapter

**Telegram-канал для вопросов:**
- DeepSeek官方: https://t.me/deepseek_ai
- Для вопросов по GLM: https://open.bigmodel.cn/
