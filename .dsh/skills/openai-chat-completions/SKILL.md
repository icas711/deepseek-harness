---
name: openai-chat-completions
description: "Протокол OpenAI Chat Completions — запрос и роли сообщений, tools/tool_choice, SSE-стриминг, аккумуляция delta.tool_calls и цикл вызова инструментов; отличия совместимых серверов Ollama и vLLM"
whenToUse: "Когда агент пишет, отлаживает или портирует HTTP-клиент Chat Completions, разбирает SSE-чанки и фрагменты delta.tool_calls, строит цикл function calling либо сталкивается с отличиями совместимых реализаций — Ollama и vLLM (флаги tool-call-парсеров)"
---

# OpenAI Chat Completions: протокол, tool calls, стриминг, Ollama и vLLM

Справочник по wire-протоколу `POST /v1/chat/completions`: сообщения, инструменты, SSE-чанки, сборка `delta.tool_calls` из фрагментов и отличия самостоятельных серверов (Ollama, vLLM) от OpenAI. Примеры — на Python (httpx).

> Статус проверки: ядро протокола (messages, tools, SSE, tool_calls, usage) сверено с боевой реализацией `packages/llm/llm-deepseek` и `packages/llm/llm-zai` этого репозитория, протестированной против живого API. Версионно-зависимые факты (OpenAI max_completion_tokens/developer/strict по официальной OpenAPI-спеке; Ollama — docs.ollama.com: streaming tools, num_ctx=4096, keep_alive; vLLM — docs.vllm.ai: парсеры, tool_choice) сверены с официальной веб-документацией; детали, не покрытые ею, помечены по месту.

## Базовый запрос

```
POST {base_url}/v1/chat/completions
Authorization: Bearer <ключ>        # Ollama принимает любое непустое значение
Content-Type: application/json
```

`base_url`: OpenAI — `https://api.openai.com/v1`; Ollama — `http://localhost:11434/v1`; vLLM — `http://<host>:8000/v1`.

| Поле | Тип | Описание |
|---|---|---|
| `model` | string | Обязательно. У Ollama — тег модели (`qwen2.5:14b`), у vLLM — имя из команды запуска |
| `messages` | array | Обязательно. История диалога, порядок строгий |
| `stream` | boolean | `true` включает SSE-стриминг; по умолчанию `false` |
| `stream_options` | object | `{"include_usage": true}` — перед `[DONE]` придёт чанк с `usage` |
| `temperature` | number | 0–2, по умолчанию 1 |
| `max_tokens` | integer | Лимит выходных токенов; у OpenAI вытесняется `max_completion_tokens` (см. ниже) |
| `max_completion_tokens` | integer | Замена `max_tokens` у OpenAI; Ollama/vLLM принимают `max_tokens` |
| `tools` | array | Описания функций (JSON Schema) |
| `tool_choice` | string / object | Стратегия выбора инструмента |
| `stop` | array[string] | До 4 стоп-строк; генерация останавливается на любой из них |

`max_tokens` vs `max_completion_tokens` (по официальной OpenAI-спеке): `max_tokens` помечен **deprecated** в пользу `max_completion_tokens` и **несовместим с o-series моделями**; для остальных моделей оба поля работают. Совместимые серверы (DeepSeek, Ollama, vLLM) используют `max_tokens`.

## Сообщения: роли и content-части

| Роль | Поля | Формат content |
|---|---|---|
| `system` | `content` | Строка с инструкциями. У OpenAI есть также роль `developer` (подтверждена спекой: поля `content`/`name`; замещает `system` для новых моделей — семантика различается по моделям) |
| `user` | `content` | Строка ИЛИ массив content-частей (multimodal) |
| `assistant` | `content`, опционально `tool_calls` | Строка или `null`; при `tool_calls` часто пустая |
| `tool` | `tool_call_id`, `content` | Строка — результат одного вызова инструмента |

Content-части (multimodal user, поддерживается не всеми моделями; текстовые бэкенды вроде DeepSeek chat отвергают картинки; `data:image/png;base64,...` в `image_url.url` допустим у OpenAI; текстовой модели — слать `content` строкой):

```json
"content": [
  {"type": "text", "text": "Что на изображении?"},
  {"type": "image_url", "image_url": {"url": "https://example.com/cat.png"}}
]
```

Assistant-сообщение с завершёнными вызовами (replay в истории): `content` — строка (допустимо `""`, надёжнее, чем `null` — некоторые шлюзы, включая DeepSeek, отвергают `null` при `tool_calls`); формат `tool_calls[]` — в разделе «Цикл tool-calls». `function.arguments` — всегда **сырая JSON-строка**, не объект.

## tools и tool_choice

```json
{"type": "function", "function": {
  "name": "get_weather",
  "description": "Текущая погода в городе",
  "parameters": {"type": "object", "properties": {
    "city": {"type": "string", "description": "Название города"},
    "units": {"type": "string", "enum": ["c", "f"]}},
    "required": ["city"]}
}}
```

- `parameters` — JSON Schema c `"type": "object"`; сериализуйте строго (никаких Python-объектов в JSON-запросе).
- `name` — обычно `^[a-zA-Z0-9_-]{1,64}$`.
- У OpenAI есть режим `strict: true` в `function` (подтверждён спекой: boolean, по умолчанию `false`): модель обязана следовать схеме из `parameters` точно; при `strict: true` поддерживается только подмножество JSON Schema (Structured Outputs).

`tool_choice`:

| Значение | Поведение |
|---|---|
| `"auto"` | По умолчанию: модель решает сама |
| `"none"` | Вызовы запрещены, даже если `tools` переданы |
| `"required"` | Модель обязана вызвать хотя бы одну функцию |
| `{"type": "function", "function": {"name": "get_weather"}}` | Вызвать ровно указанную |

## Нестримовый ответ

```json
{"id": "chatcmpl-xyz", "object": "chat.completion", "created": 1735689600, "model": "...",
 "choices": [{"index": 0, "finish_reason": "tool_calls", "message": {
   "role": "assistant", "content": null,
   "tool_calls": [{"id": "call_abc", "type": "function",
     "function": {"name": "get_weather", "arguments": "{\"city\": \"Paris\"}"}}]}}],
 "usage": {"prompt_tokens": 9, "completion_tokens": 12, "total_tokens": 21,
   "prompt_tokens_details": {"cached_tokens": 0},
   "completion_tokens_details": {"reasoning_tokens": 0}}}
```

`finish_reason`: `stop` (естественное завершение), `length` (лимит токенов), `tool_calls` (модель требует инструменты), `content_filter`; возможно расширение словаря — нужен default-обработчик. `usage.total_tokens` есть у OpenAI, у DeepSeek вместо него поля `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`, причём `prompt_tokens` уже **включает** cache hits.

## Стриминг (SSE)

Каждое событие — строка `data: <JSON>`; последнее — `data: [DONE]`; между событиями пустая строка (SSE framing). Обрыв соединения до `[DONE]` — усечённый ответ, доверять которому нельзя.

```
data: {"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1735689600,"model":"...","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":{"content":"Погода в Париже"},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"city\": \"Paris\"}"}}]},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}

data: {"id":"...","choices":[],"usage":{"prompt_tokens":42,"completion_tokens":18,"total_tokens":60}}

data: [DONE]
```

Правила:

- `delta.role` приходит только в первом чанке; дальше `delta.content` (текст накапливается конкатенацией) или `delta.tool_calls`.
- `delta.content` может быть `null`/`""` на чанках с tool_calls — не ошибка.
- `finish_reason` non-null только в терминальном чанке выбора (может быть чанк с пустым `delta: {}`).
- При `stream_options.include_usage` все чанки несут `"usage": null`, а перед `[DONE]` идёт отдельный чанк с `"choices": []` и заполненным `usage`. DeepSeek может приложить usage к финишному чанку И/ИЛИ прислать trailing usage-only чанк — обрабатывайте оба случая, берите последний.
- Неизвестные поля `delta` игнорируйте (DeepSeek/Z.ai шлют `reasoning_content` — это расширение, не часть OpenAI-протокола).

## Аккумуляция delta.tool_calls

- Фрагменты группируются по `index` (порядок прихода не гарантируется, параллельные вызовы перемежаются).
- `id` и `type` — только в первом фрагменте вызова; в последующих этих полей нет.
- `function.name` обычно целиком в первом фрагменте, но может прийти частями — надёжнее конкатенировать.
- `function.arguments` — фрагменты JSON-строки; накапливаются конкатенацией **всех** фрагментов, включая первый (там обычно `""`). Парсить `json.loads` один раз — после конца стрима.

```python
def accumulate_tool_calls(fragments):
    """fragments — все delta.tool_calls из чанков одного ответа (в порядке прихода)."""
    calls = {}
    for frag in fragments:
        c = calls.setdefault(frag["index"], {"id": None, "type": "function",
                                             "function": {"name": "", "arguments": ""}})
        if frag.get("id"):
            c["id"] = frag["id"]
        fn = frag.get("function") or {}   # у продолжений поля function может не быть
        if fn.get("name"):
            c["function"]["name"] += fn["name"]
        c["function"]["arguments"] += fn.get("arguments") or ""
    return [calls[i] for i in sorted(calls)]   # порядок по index
```

## Цикл tool-calls

Порядок в `messages`: `assistant` с `tool_calls[]` → по одному `role: "tool"` на **каждый** вызов, в том же порядке и с совпадающими `tool_call_id` → финальный `assistant` с текстом. Пропуск tool-сообщения — ошибка 400 («assistant message with tool_calls must be followed by tool messages»). `content` tool-сообщения — строка (обычно `json.dumps` результата); пустой результат — тоже строка (`""` или заглушка).

```json
{"role": "assistant", "content": "", "tool_calls": [
  {"id": "call_a", "type": "function", "function": {"name": "get_weather", "arguments": "{\"city\": \"Paris\"}"}},
  {"id": "call_b", "type": "function", "function": {"name": "get_weather", "arguments": "{\"city\": \"Rome\"}"}}]}
{"role": "tool", "tool_call_id": "call_a", "content": "{\"t\": 18}"}
{"role": "tool", "tool_call_id": "call_b", "content": "{\"t\": 24}"}
```

Затем повторный запрос с расширенной историей — до ответа без `tool_calls` (`finish_reason: "stop"`).

## Ollama: OpenAI-совместимый слой

- Совместимый слой живёт на `http://localhost:11434/v1` (`/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/models`) и транслируется в нативный `POST /api/chat`. API-ключ — любое непустое значение.
- `tools` поддерживаются с v0.3.0 на моделях с шаблоном инструментов (llama3.1+, qwen2.5, mistral-nemo, command-r+ и др.). Модель без шаблона — вызовы не сработают.
- Стриминг tool calls **поддерживается**: официальная страница tool-calling документирует раздел «Tool calling with streaming» (аккумуляция `thinking`/`content`/`tool_calls` по чанкам), а страница OpenAI-совместимости заявляет Streaming и Tools среди поддерживаемых возможностей. `stream_options.include_usage` — заявленный поддерживаемый параметр запроса. Не документировано явно: значение `finish_reason` при вызове инструментов в `/v1`-стриме и поведение `usage` в стриме без `include_usage` — при портировании проверяйте на живом сервере.

Отличия нативного `POST /api/chat` от совместимого слоя:

| Аспект | `/v1/chat/completions` | `/api/chat` (нативный) |
|---|---|---|
| `tool_calls[].function.arguments` | строка JSON | **объект** |
| `id`/`type` в `tool_calls` ответа | есть | нет |
| Фрейминг стрима | SSE `data:` / `[DONE]` | JSON-lines с флагом `done` |
| usage | объект `usage` | `prompt_eval_count` / `eval_count` |
| Контекст/жизнь модели | — | `options.num_ctx`, `keep_alive` |

`keep_alive` — время удержания модели в памяти после запроса: `"5m"` (умолчание по docs/api.md), `"0"` (выгрузить сразу), `"-1"` (держать всегда); также env `OLLAMA_KEEP_ALIVE` (те же типы значений). `options.num_ctx` — размер контекста; по официальному FAQ умолчание — **4096** токенов, глобально меняется env `OLLAMA_CONTEXT_LENGTH` (например, `OLLAMA_CONTEXT_LENGTH=8192 ollama serve`). Ловушка Ollama: при превышении `num_ctx` промпт **тихо обрезается** без ошибки — следить по `prompt_eval_count` или задавать `num_ctx` явно.

## vLLM: tool calling

Запуск с инструментами обязателен с двумя флагами:

```sh
vllm serve Qwen/Qwen2.5-7B-Instruct --enable-auto-tool-choice --tool-call-parser hermes
```

- Без `--enable-auto-tool-choice` любой запрос с `tools` отклоняется (400 с подсказкой про флаг); `--tool-call-parser` задаёт парсер выходов конкретной модели (список меняется между релизами — сверяйтесь с docs.vllm.ai/en/latest/features/tool_calling/).
- Парсеры (проверено по официальной странице tool calling): `hermes` (Qwen2.5, Llama-3.1/3.2 — рекомендован), `mistral`, `llama3_json` (JSON-based Llama 3.x), `llama4_pythonic` и `pythonic` (список Python-вызовов; для Llama 4 рекомендован llama4_pythonic), `deepseek_v3` и более новые `deepseek_v31`/`deepseek_v32`, `granite`/`granite4` (IBM Granite), `jamba`, `internlm`, `openai`, `glm45`/`glm47`, `kimi_k2`, `qwen3_xml`, `cohere_command3` и др.; свои парсеры подключаются плагином `--tool-parser-plugin`.
- `tool_choice`: `auto`, `required` (гарантированный вызов одной или нескольких функций), имя функции — и **`"none"` теперь поддерживается**: по умолчанию при `tool_choice='none'` определения инструментов всё равно включаются в промпт; чтобы исключить их, добавьте флаг `--exclude-tools-when-tool-choice-none`.
- Стриминг tool calls поддержан (SSE как у OpenAI, фрагменты по `index`); `hermes` поддерживает параллельные вызовы. `usage` — как у OpenAI: финальный чанк при `stream_options.include_usage`.

## Канонический Python-клиент (httpx)

Полный цикл: стриминговый разбор SSE + аккумуляция tool_calls + выполнение + `role: "tool"` + финальный ответ.

```python
import json
import httpx

BASE_URL = "http://localhost:8000/v1"  # OpenAI: https://api.openai.com/v1; Ollama: http://localhost:11434/v1
API_KEY = "xxx"                        # Ollama: любое значение
MODEL = "Qwen/Qwen2.5-7B-Instruct"

def chat(messages, tools=None):
    body = {"model": MODEL, "messages": messages, "stream": True,
            "stream_options": {"include_usage": True}, "tool_choice": "auto"}
    if tools:
        body["tools"] = tools
    text, frags, usage, finish = [], [], None, None
    with httpx.Client(timeout=300) as client, client.stream(
            "POST", f"{BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {API_KEY}"}, json=body) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if not line.startswith("data:"):
                continue                      # пустые строки и SSE-комментарии
            data = line[5:].strip()
            if data == "[DONE]":
                break
            chunk = json.loads(data)
            if chunk.get("usage"):
                usage = chunk["usage"]        # usage-only чанк ИЛИ финишный чанк
            for choice in chunk.get("choices", []):
                delta = choice.get("delta") or {}
                if delta.get("content"):
                    text.append(delta["content"])
                frags.extend(delta.get("tool_calls") or [])
                if choice.get("finish_reason"):
                    finish = choice["finish_reason"]
    return "".join(text), accumulate_tool_calls(frags), usage, finish

def run_agent(user_query, tools):
    messages = [{"role": "user", "content": user_query}]
    while True:
        text, tool_calls, usage, finish = chat(messages, tools)
        if not tool_calls:
            return text, usage
        messages.append({"role": "assistant", "content": text,
                         "tool_calls": tool_calls})
        for call in tool_calls:
            args = json.loads(call["function"]["arguments"] or "{}")
            result = dispatch(call["function"]["name"], args)  # ваша функция
            messages.append({"role": "tool", "tool_call_id": call["id"],
                             "content": json.dumps(result, ensure_ascii=False)})
```

Обрыв до `[DONE]` (httpx поднимет исключение или цикл кончится без терминатора) — усечённый ответ, ретраить целиком.

## Типичные ошибки

- `json.loads` на каждом фрагменте `function.arguments` — аргументы идут кусками; собирать строку и парсить один раз в конце.
- Группировка фрагментов по `id` вместо `index` — `id` есть только в первом фрагменте вызова.
- Пропуск tool-сообщения для одного из параллельных `tool_calls` → 400; отвечать нужно на каждый вызов.
- `"content": null` в replay assistant-сообщения с `tool_calls` — часть шлюзов (DeepSeek) отвергает; слать `""`.
- Ожидание `usage` в стриме без `stream_options.include_usage` — поля не будет; тихий обрыв до `[DONE]` без детекции — неполный ответ выглядит валидным.
- `max_tokens` для o-series моделей OpenAI → ошибка; поле deprecated в пользу `max_completion_tokens` (подтверждено официальной спекой: «not compatible with o-series models»).
- Массив content-частей с `image_url` текстовой модели; Ollama-модель без тега версии; тихая обрезка контекста при `num_ctx` меньше промпта.

## Документация

Ссылки — официальные канонические адреса, проверенные прямым fetch (OpenAI — по машинно-читаемой OpenAPI-спеке репозитория openai/openai-openapi: platform.openai.com отдаёт 403 без браузера). Сервер Ollama и vLLM сверялись с этими страницами:

- OpenAI API Reference — Chat Completions: https://platform.openai.com/docs/api-reference/chat ; спека: https://github.com/openai/openai-openapi (openapi.json)
- OpenAI Function Calling guide: https://platform.openai.com/docs/guides/function-calling
- OpenAI Streaming: https://platform.openai.com/docs/api-reference/streaming
- Ollama — OpenAI compatibility (актуальный адрес; docs/openai.md из репозитория удалён): https://docs.ollama.com/api/openai-compatibility
- Ollama — Tool calling (включая стриминг tool calls): https://docs.ollama.com/capabilities/tool-calling
- Ollama — Native API (`/api/chat`, `keep_alive`, `options`): https://github.com/ollama/ollama/blob/main/docs/api.md ; FAQ (num_ctx, OLLAMA_CONTEXT_LENGTH): https://docs.ollama.com/faq
- vLLM — Tool calling (`--enable-auto-tool-choice`, `--tool-call-parser`, `tool_choice`): https://docs.vllm.ai/en/latest/features/tool_calling/ (старый URL /serving/openai_compatible_server редиректит на /serving/online_serving/)
