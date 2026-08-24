---
name: pytest-testing
description: "Справочник по pytest — фикстуры и scope, yield-teardown, parametrize, autouse, conftest, встроенные фикстуры, stub/fake/mock и unittest.mock, контракт-тесты провайдер/имплементация и pytest-asyncio"
whenToUse: "Когда пишешь или рефакторишь тесты на pytest: фикстуры и их области видимости, teardown, параметризация, встроенные фикстуры (tmp_path, capsys, monkeypatch, caplog), выбор между ручными fake и unittest.mock, контракт-тесты нескольких реализаций одного интерфейса или API-клиента по схеме, а также асинхронные тесты на pytest-asyncio"
---

# pytest: фикстуры, подмены, контракт-тесты и async

Плотный справочник по pytest. Поведение проверено реальными прогонами на pytest 9.0.2 и pytest-asyncio 1.3.0 (Python 3.12).

## Фикстуры

```python
import pytest

@pytest.fixture
def conn():                      # function-scope по умолчанию
    return make_conn()

@pytest.fixture(scope="session")
def database():                  # один раз на запуск
    db = start_db()
    yield db
    stop_db()
```

### Scope

| Scope | Создание / teardown |
|---|---|
| `function` (по умолчанию) | перед каждым тестом / после каждого |
| `class` | один раз на класс / после последнего метода класса |
| `module` | один раз на модуль / после последнего теста модуля |
| `package` | на пакет (нужен `__init__.py`) / после последнего теста пакета |
| `session` | один раз на запуск / в конце запуска |

- Фикстура `scope="class"` из модульного conftest, запрошенная обычной функцией-тестом (не методом класса), деградирует до function-scope — создаётся под каждый такой тест (проверено прогоном).
- Фикстура большего scope не может зависеть от меньшего (`session` не запросит `function`).

### yield-фикстуры: teardown

```python
@pytest.fixture
def temp_store(tmp_path):
    store = Store(root=tmp_path)      # setup
    yield store                       # значение теста
    store.cleanup()                   # teardown: выполняется ВСЕГДА, даже если тест упал
```

- Teardown — LIFO: для цепочки `a -> b(a)` лог `a-setup, b-setup, b-teardown, a-teardown` (проверено прогоном).
- Teardown выполняется и при падении теста; исключение в teardown дополнительно репортится как error.

### params и ids

```python
@pytest.mark.parametrize("value,expected", [
    (1, "1"),
    (2, "2"),
], ids=["one", "two"])                 # узлы test_str[one], test_str[two]
def test_str(value, expected):
    assert str(value) == expected
```

- Каждый набор аргументов — отдельный узел; падение одного не отменяет остальные.
- Фикстура тоже параметризуется: `@pytest.fixture(params=[...])`; текущее значение — `request.param`; `ids` — список или функция (`ids=lambda cls: cls.__name__`).

### autouse и conftest.py

```python
@pytest.fixture(autouse=True)
def isolate_env(monkeypatch):
    monkeypatch.delenv("API_KEY", raising=False)   # применяется ко ВСЕМ тестам области
```

- `autouse=True` выполняется неявно для всех тестов своей области (файл/класс/модуль — где объявлен), даже если тест не заявляет фикстуру; идеально для изоляции окружения, тяжёлые операции — удар по скорости набора.
- Фикстуры из `conftest.py` доступны тестам каталога и подкаталогов без импорта; вложенные conftest объединяются (тест в `sub/` видит фикстуры корневого и `sub/conftest.py`). Там же живут хуки (`pytest_configure`) и общие фабрики.

## Встроенные фикстуры

| Фикстура | Что даёт | Ключевые операции |
|---|---|---|
| `tmp_path` | `pathlib.Path` уникального каталога | уникален на тест; база — `--basetemp` |
| `capsys` | захват stdout/stderr | `readouterr() -> (out, err)`; повторный вызов — только новое |
| `capfd` | то же на уровне файловых дескрипторов | для subprocess/C-расширений |
| `monkeypatch` | обратимые подмены | `setenv`, `delenv(raising=False)`, `setattr`, `delattr`, `chdir`, `setitem` |
| `caplog` | доступ к логам | `set_level(logging.DEBUG)`, `caplog.records`, `caplog.text` |
| `request` | контекст теста | `request.param`, `request.getfixturevalue(name)` |

- `capsys.readouterr().out` от `print("x")` вернёт `"x\n"` (перевод строки включён); `sys.stderr.write("e")` — `"e"` без него. `monkeypatch` откатывает всё при завершении теста: env, атрибуты, `sys.path`, cwd.

## Fake-объекты: stub, fake, mock

- **Stub** — заглушка с зашитыми ответами, чтобы код дошёл до нужной ветки. **Fake** — рабочая лёгкая реализация (in-memory репозиторий вместо БД). **Mock** — объект, записывающий вызовы для утверждений (`assert_called_with`).

Выбор:

- Долгоживущее поведение (репозиторий, шина, кэш) — ручной fake-класс: понятнее, переиспользуется, не рассыпается при рефакторинге.
- Граница с внешним миром (платёжный шлюз, SMTP) — unittest.mock: важен факт и аргументы вызова.
- Мок внутренних коллабораторов своего кода — запах переизоляции: тест фиксирует реализацию и ломается при эквивалентном рефакторинге. Мок также вреден, когда подменяет тип с дешёвыми настоящими инвариантами.

```python
# Ручной fake: поведение, переиспользование, читаемые падения
class FakeRepo:
    def __init__(self):
        self.items = {}
    def put(self, k, v):
        self.items[k] = v
    def get(self, k):
        return self.items[k]

def test_put_get():
    repo = FakeRepo()
    repo.put("a", 1)
    assert repo.get("a") == 1

# unittest.mock: граница, вызов с точными аргументами
from unittest import mock

class Gateway:
    def charge(self, token, amount): ...

def test_charge_calls_gateway():
    gw = mock.create_autospec(Gateway)
    gw.charge.return_value = {"ok": True}
    Service(gw).buy("tok_1", 500)
    gw.charge.assert_called_once_with("tok_1", 500)
```

Справка по unittest.mock (проверено исполнением):

- `Mock` — вызовы и атрибуты; магические методы НЕ поддерживает (`len(m)` → TypeError). `MagicMock` — то же + `__len__`, `__getitem__`, `__iter__`...
- `AsyncMock` — `await m()` возвращает `return_value`; трекинг: `assert_awaited_once_with(...)`. `mock.patch` асинхронного атрибута автоматически создаёт `AsyncMock`.
- `Mock(spec=Real)` режет несуществующие атрибуты (AttributeError), но сигнатуры вызовов НЕ проверяет; `create_autospec(Real)` проверяет и сигнатуры (неверное число аргументов → TypeError) — для строгих границ предпочитай его.
- `m.call_count`, `m.call_args_list`, `m.reset_mock()`; `mock.patch("module.attr", value)` — контекст-менеджер и декоратор, восстанавливает исходное значение на выходе (проверено).

monkeypatch (фикстура pytest) — для env/cwd/атрибутов модулей с автооткатом; `mock.patch` — когда нужны call-утверждения или патчинг класса целиком. Не смешивай оба на одном объекте в одном тесте.

## Контракт-тесты

Паттерн: несколько реализаций одного интерфейса прогоняются через один набор параметризованных тестов.

```python
import pytest
from storage import MemoryStorage, RedisStorage   # провайдеры одного контракта

IMPLEMENTATIONS = [MemoryStorage, RedisStorage]

@pytest.fixture(params=IMPLEMENTATIONS, ids=lambda cls: cls.__name__)
def store(request):
    return request.param()                     # каждая реализация получит все тесты ниже

def test_put_then_get(store):                  # контракт: запись читается назад
    store.put("a", 1)
    assert store.get("a") == 1
```

- `2 реализации × 3 теста = 6 узлов` вида `test_put_then_get[MemoryStorage]` (проверено прогоном); новая имплементация — одна строка в `IMPLEMENTATIONS`. Альтернатива — абстрактный базовый тестовый класс: наследник реализует `make()`, унаследованные `test_*` применяются к его имплементации.

### Контракт API-клиента по схеме

```python
# contract.py — явная схема ответа
USER_SCHEMA = {"id": int, "name": str, "admin": bool}

def validate_user(obj):
    assert set(obj) == set(USER_SCHEMA), f"поля не совпадают: {sorted(obj)}"
    for k, t in USER_SCHEMA.items():
        assert isinstance(obj[k], t), f"{k}: ожидался {t.__name__}"

# test_client.py — клиент против fake-транспорта, ответ сверен со схемой
def test_get_user_matches_schema():
    fake_transport = lambda path: {"id": 1, "name": "ann", "admin": False}
    client = UserClient(fake_transport)
    assert validate_user(client.get_user(1))
```

- Схема ловит и недостающие, и лишние поля — контракт провайдера фиксируется явно. Fake-транспорт держит тест мгновенным; реальный транспорт — отдельные малочисленные интеграционные тесты. Для сложных форм — Pydantic (скил json-pydantic-v2).

### Фикстуры-фабрики

```python
@pytest.fixture
def make_user():
    def _make(id=1, name="x", **extra):        # дефолты + точечные переопределения
        return {"id": id, "name": name, **extra}
    return _make

def test_override(make_user):
    assert make_user(id=9, tag="t") == {"id": 9, "name": "x", "tag": "t"}
```

Фабрика лучше `params`, когда тесту нужно несколько связанных объектов; комбинируется с контрактом: фабрика генерирует валидные по схеме записи, тест портит конкретное поле.

## pytest-asyncio

Режимы (`asyncio_mode` в `pytest.ini` / `pyproject.toml`):

| Режим | Поведение |
|---|---|
| `strict` (по умолчанию) | тест обязан иметь `@pytest.mark.asyncio` |
| `auto` | любой `async def` тест выполняется автоматически |

Режим `legacy` в 1.3.0 удалён: указание в конфиге валит коллекцию с `ValueError: 'legacy' is not a valid Mode` (проверено).

```ini
[pytest]
asyncio_mode = auto
```

```python
@pytest.mark.asyncio                 # strict
async def test_fetch():
    assert await fetch(1) is not None

@pytest.fixture
async def session():                 # async-фикстура с teardown (auto mode)
    s = await connect()
    yield s
    await s.close()

async def test_session(session):     # auto — маркер не нужен
    assert await session.ping()
```

- В strict-режиме немаркированный `async def` тест **падает** с «async def functions are not natively supported» (ядро pytest отказывается, это не skip).
- Асинхронные фикстуры работают в auto-режиме без маркеров; в strict маркируются `@pytest_asyncio.fixture`. По умолчанию каждый тест получает **новый event loop** (`id(asyncio.get_running_loop())` различается между тестами); `loop_scope` расширяет жизнь loop на module/session — module-scoped async-фикстура успешно переиспользуется. `parametrize` ортогонален async.

Для FastAPI есть синхронный `TestClient`; полностью async-вариант — `httpx.AsyncClient` + `ASGITransport` (скил python-asyncio-fastapi).

## Типичные ошибки

- **Немаркированный async-тест в strict-режиме** — падает, а не пропускается; поставь маркер или включи auto.
- **`scope="class"` фикстура, заявленная вне класса** — реально создаётся на каждый тест; **мутации session-данных из function-тестов** — протечки между тестами, изолируй фабрикой.
- **Магические методы на `Mock`** — нужен `MagicMock`; **`spec=` как «проверка сигнатур»** — сигнатуры проверяет `create_autospec`.
- **Мок внутренних коллабораторов** — тест фиксирует реализацию; мок только внешние границы.
- **Проверка вывода без учёта `\n`** — capsys возвращает print-вывод с завершающим переводом строки.
- **Отсутствие teardown у ресурсных фикстур** — всегда `yield` + `finally`-стиль.

## Документация

Ссылки — канонические адреса официальной документации; в момент написания скила сетевой доступ был недоступен, страницы онлайн не открывались. Все факты проверены реальными прогонами pytest 9.0.2 и pytest-asyncio 1.3.0 (Python 3.12.6), сигнатуры — интроспекцией установленных пакетов:

- pytest Fixtures (scope, yield, conftest): https://docs.pytest.org/en/stable/how-to/fixtures.html
- pytest Parametrize: https://docs.pytest.org/en/stable/how-to/parametrize.html
- pytest tmp_path: https://docs.pytest.org/en/stable/how-to/tmp_path.html
- pytest monkeypatch: https://docs.pytest.org/en/stable/how-to/monkeypatch.html
- pytest capsys: https://docs.pytest.org/en/stable/how-to/capture-stdout-stderr.html
- pytest caplog: https://docs.pytest.org/en/stable/how-to/logging.html
- unittest.mock: https://docs.python.org/3/library/unittest.mock.html
- pytest-asyncio: https://pytest-asyncio.readthedocs.io/
