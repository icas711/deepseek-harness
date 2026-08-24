---
name: python-asyncio-fastapi
description: "Справочник по async-генераторам, TaskGroup, timeout и отмене задач в asyncio плюс async-маршруты, StreamingResponse, WebSocket, lifespan и зависимости с yield в FastAPI, включая тестирование через TestClient и dependency_overrides"
whenToUse: "Когда пишешь или отлаживаешь асинхронный код на asyncio (стриминг async-генераторами, отмена задач, TaskGroup, timeout), FastAPI-приложение (async/def маршруты, стриминг, WebSocket, lifespan, зависимости с yield) или тесты к нему через TestClient, httpx и dependency_overrides"
---

# Python asyncio + FastAPI: стриминг, WebSocket, lifespan и тестирование

Плотный справочник по связке asyncio и FastAPI. Поведение API проверено исполнением на Python 3.12.6, fastapi 0.115.14, starlette 0.46.2, httpx 0.28.1.

## Async-генераторы

```python
import asyncio
from contextlib import aclosing

async def tokens():
    try:
        for i in range(3):
            await asyncio.sleep(0)      # единственная точка suspend
            yield f"t{i}"
    finally:
        ...                              # закрытие ресурсов

async def consumer(stream):
    async with aclosing(stream) as it:   # гарантия aclose() даже при break/исключении
        async for chunk in it:
            if not chunk:
                break
            yield chunk                  # пересылка дальше
```

Факты:

- У объекта async-генератора есть `__aiter__`, `__anext__`, `asend`, `athrow`, `aclose`.
- `aclose()` возбуждает `GeneratorExit` в точке приостановленного `yield`; `finally` выполняется; повторный `__anext__` даёт `StopAsyncIteration`. Повторный `aclose()` — no-op.
- Пойманный `GeneratorExit` нельзя «глотать» — обязательно `raise` (иначе RuntimeError). В `finally` после него допустимы только быстрые синхронные действия.
- Ресурс открывай до первого `yield`, закрывай в `finally`; `contextlib.aclosing` (3.11+) делает закрытие детерминированным.
- Для шины событий — `asyncio.Queue`: `put`, `get`, `put_nowait`, `get_nowait`, `qsize`, `empty`, `task_done`, `join`.

## Отмена задач и таймауты

- `task.cancel()` возбуждает `asyncio.CancelledError` внутри задачи в ближайшей точке await; `await task` после отмены ретранслирует его наружу. В обработчике либо `raise`, либо осознанное подавление — «глотание» ломает shutdown.
- `asyncio.timeout(delay)` (3.11+): параметр называется именно `delay` (`float | None`); по истечении отменяет вложенный код, наружу выходит встроенный `TimeoutError` (не отдельный `asyncio.TimeoutError` — алиас).
- `asyncio.timeout_at(when)` — абсолютный дедлайн по `loop.time()`; `reschedule(when)` двигает границу.

```python
async def fetch_with_deadline(coro):
    async with asyncio.timeout(0.5):    # истечение -> TimeoutError наружу
        return await coro
```

## TaskGroup (3.11+)

```python
async def run_all():
    async with asyncio.TaskGroup() as tg:
        t1 = tg.create_task(worker(1))   # create_task(coro, *, name=None, context=None)
        t2 = tg.create_task(worker(2))
    # выход из блока ждёт все задачи
```

- При исключении в одной задаче sibling-задачи отменяются, ошибки собираются в `ExceptionGroup`, пробрасываемый из `async with`.
- Ловля: `except* ValueError as eg` (доступ `eg.exceptions`); для синхронного кода — `except BaseExceptionGroup`. Не оставляй задачи «на будущее» без отмены: не завершённые к выходу задачи — ошибка структуры.

## FastAPI: async def против def

- `async def` — маршрут в event loop; синхронный `def` — Starlette выполняет через `run_in_threadpool` (обёртка anyio), loop не блокируется.
- Внутри `async def` запрещены блокирующие вызовы (`requests`, `time.sleep`, тяжёлый CPU) — они замораживают весь loop; переводи в `def`-маршрут или `asyncio.to_thread`. `def`-маршрут не блокирует loop, но расходует поток пула anyio (по умолчанию 40 токенов) — очень долгая работа в нём тоже нежелательна.

## StreamingResponse с async-генератором

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()

async def sse_events():
    for i in range(10):
        yield f"data: {i}\n\n"

@app.get("/events")
async def events():
    return StreamingResponse(sse_events(), media_type="text/event-stream")
```

Сигнатура: `StreamingResponse(content, status_code=200, headers=None, media_type=None, background=None)`; `content` — sync- или async-итератор (генератор, не список).

Обрыв соединения (проверено по исходникам starlette): `StreamingResponse.__call__` запускает в anyio task group `stream_response` и `listen_for_disconnect`; при ASGI-сообщении `http.disconnect` (его шлёт реальный сервер типа uvicorn) стриминг-задача отменяется, генератор закрывается, `finally` отрабатывает. В TestClient ранний разрыв надёжно НЕ эмулируется: чтение бесконечного генератора через `client.stream(...)` зависает (проверено) — тестируй конечные генераторы целиком, а закрытие по обрыву — отдельной проверкой генератора (`aclose()`/`finally`).

## WebSocket-эндпоинты

Методы `starlette.websockets.WebSocket` (реэкспортируется из `fastapi`): `accept`, `close`, `receive`, `receive_text`, `receive_bytes`, `receive_json`, `send`, `send_text`, `send_bytes`, `send_json`, `iter_text`, `iter_bytes`, `iter_json`.

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI()

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []
    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)
    async def send_personal(self, msg: dict, ws: WebSocket):
        await ws.send_json(msg)
    async def broadcast(self, msg: dict):
        for ws in list(self.active):        # копия: active может меняться
            await ws.send_json(msg)

manager = ConnectionManager()

@app.websocket("/ws/{client_id}")
async def ws_endpoint(ws: WebSocket, client_id: str):
    await manager.connect(ws)
    try:
        while True:
            text = await ws.receive_text()
            await manager.send_personal({"echo": text, "to": client_id}, ws)
    except WebSocketDisconnect:
        manager.disconnect(ws)
```

- `WebSocketDisconnect(code=1000, reason=None)` — импортируется и из `fastapi`, и из `starlette.websockets` (один класс); возбуждается сервером при отключении клиента.
- Зависимости (`Depends`) работают и в websocket-эндпоинтах, включая `dependency_overrides` в тестах. До `accept()` можно сделать `await ws.close(code=...)` — например, при отказе авторизации.

## Lifespan вместо @app.on_event

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = await create_pool()          # startup: до первого запроса
    app.state.pool = pool
    yield                               # приложение работает
    await pool.close()                  # shutdown: после последнего ответа

app = FastAPI(lifespan=lifespan)
```

- Параметр конструктора: `FastAPI(lifespan=...)`; функция — async context manager, `yield` разделяет startup/shutdown.
- `@app.on_event("startup"/"shutdown")` в fastapi 0.115 даёт `DeprecationWarning` с рекомендацией перейти на lifespan — не используй в новом коде.
- В тестах lifespan выполняется только при `with TestClient(app) as client:`. Без `with` запросы работают, но startup/shutdown не запускаются.

## Зависимости с yield

```python
async def get_session():
    session = SessionLocal()
    try:
        yield session                   # значение инжектится в маршрут
    finally:
        await session.close()           # teardown

@app.get("/items")
async def items(session=Depends(get_session)):
    return await session.fetch_all()
```

Проверенный порядок: setup → тело маршрута → отправка ответа → teardown. Teardown выполняется всегда, включая исключения в маршруте.

## Тестирование

### TestClient (starlette, поверх httpx)

```python
from fastapi.testclient import TestClient

def test_ping():
    with TestClient(app) as client:         # + lifespan
        assert client.get("/ping").status_code == 200

def test_boom():
    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/boom").status_code == 500   # исключение не пробрасывается
```

- Без `raise_server_exceptions=False` исключение маршрута пробрасывается прямо в тест; `client.stream("GET", "/events")` — контекст стримингового ответа, далее `resp.iter_lines()` / `iter_bytes()`.

### WebSocket через TestClient

```python
def test_ws():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/alice") as ws:   # (url, subprotocols=None, **kwargs)
            ws.send_text("hello")
            assert ws.receive_json() == {"echo": "hello", "to": "alice"}
```

Выход из `with` разрывает соединение — серверный обработчик получает `WebSocketDisconnect`.

### dependency_overrides

```python
app.dependency_overrides[get_current_user] = lambda: User(name="test")
app.dependency_overrides[get_db] = fake_db          # sync и async зависимости

try:
    ...  # тесты
finally:
    app.dependency_overrides.clear()
```

- Ключ — исходная функция зависимости (без `Depends`); подмена действует для HTTP- и websocket-эндпоинтов. В pytest удобно чистить teardown-фикстурой или `monkeypatch.setitem(app.dependency_overrides, real_dep, fake_dep)`.

### Асинхронные тесты: httpx.AsyncClient + ASGITransport

```python
import httpx, pytest

@pytest.mark.anyio
async def test_async():
    transport = httpx.ASGITransport(app=app)   # параметры: app, raise_app_exceptions, root_path, client
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/items/5")
        assert r.json() == {"item_id": 5}
```

- Плагин anyio идёт вместе с anyio (зависимость FastAPI): фикстура `anyio_backend` (верни `"asyncio"`) + маркер `@pytest.mark.anyio`. Альтернатива — pytest-asyncio (скил pytest-testing); сам `TestClient` синхронный и event loop не нужен. Валидация типов работает как обычно: `ac.get("/items/not-an-int")` → 422.

## Типичные ошибки

- **Блокирующий вызов в `async def`-маршруте** (`requests`, `time.sleep`) — весь сервер встаёт; переводи в `def`-маршрут или `asyncio.to_thread`.
- **«Глотание» CancelledError** — всегда ретранслируй отмену.
- **`yield` в зависимости без `try/finally`** — teardown не выполнится при исключении; **тесты lifespan без `with TestClient(app)`** — startup/shutdown молча не выполняются.
- **Забытый `app.dependency_overrides.clear()`** — подмена течёт в следующие тесты.
- **Параметр `timeout` у `asyncio.timeout`** — называется `delay`; **`spec=` у MagicMock не проверяет сигнатуры вызовов** — нужен `create_autospec` (скил pytest-testing).
- **Ожидание «первого exception» из TaskGroup** — наружу приходит `ExceptionGroup`; лови через `except*`.

## Документация

Ссылки — канонические адреса официальной документации. В момент написания скила сетевой доступ был недоступен, страницы онлайн не открывались; все факты проверены исполнением кода против установленных пакетов (fastapi 0.115.14, starlette 0.46.2, httpx 0.28.1, Python 3.12.6) и чтением их исходников:

- FastAPI Lifespan Events: https://fastapi.tiangolo.com/advanced/lifespan/
- FastAPI WebSockets: https://fastapi.tiangolo.com/advanced/websockets/
- FastAPI Testing: https://fastapi.tiangolo.com/tutorial/testing/
- FastAPI Testing Dependencies: https://fastapi.tiangolo.com/advanced/testing-dependencies/
- FastAPI Dependencies with yield: https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/
- Starlette TestClient: https://www.starlette.io/testclient/
- Python Asynchronous Generators: https://docs.python.org/3/reference/expressions.html#asynchronous-generators
- Python asyncio TaskGroup и таймауты: https://docs.python.org/3/library/asyncio-task.html
- contextlib.aclosing: https://docs.python.org/3/library/contextlib.html#contextlib.aclosing
