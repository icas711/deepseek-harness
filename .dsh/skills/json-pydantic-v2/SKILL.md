---
name: json-pydantic-v2
description: Справочник по Pydantic v2 для JSON-протоколов — дискриминированные юнионы, Field и ConfigDict, валидаторы, сериализация model_dump, TypeAdapter и паттерн «кадров» (chunk/done/error) для стриминга
whenToUse: "Когда проектируешь или отлаживаешь JSON-схему протокола (кадры стриминга, RPC, события), дискриминированные юнионы, алиасы, сериализацию с фильтрами полей или roundtrip валидацию в Pydantic v2"
---

# Pydantic v2: схемы JSON-протоколов и сериализация кадров

Плотный справочник по API Pydantic v2 для описания wire-форматов: дискриминированные юнионы как основа тегированных кадров, Field/ConfigDict для контрактов, модельная сериализация и TypeAdapter для юнионов верхнего уровня. Все примеры проверены на pydantic 2.12.

## Модели и поля

```python
from enum import Enum
from typing import Annotated, Literal, Optional
from uuid import uuid4
from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator

class Role(str, Enum):
    USER = 'user'
    ASSISTANT = 'assistant'

class Message(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    id: str = Field(default_factory=lambda: uuid4().hex)
    role: Role
    text: str = Field(min_length=1, max_length=4096)
    score: float = Field(ge=0, le=1)
    code: Optional[str] = Field(default=None, pattern=r'^[A-Z]{2,8}$')
    snake_case: str = Field(alias='snakeCase', serialization_alias='snakeCase')

    @field_validator('text', mode='before')
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @model_validator(mode='after')
    def check(self):
        if self.role is Role.ASSISTANT and self.score < 0:  # пример межполевой проверки
            raise ValueError('score must be >= 0 for assistant')
        return self

    @computed_field
    @property
    def length(self) -> int:
        return len(self.text)
```

Ключевые параметры `Field` (проверено по api/fields и интроспекции 2.12): `default`, `default_factory`, `alias`, `validation_alias`, `serialization_alias`, `ge/gt/le/lt`, `multiple_of`, `min_length/max_length`, `pattern`, `discriminator`, `frozen`, `description`, `exclude`. `computed_field` включается в `model_dump()` и JSON Schema.

| Задача | Инструмент |
|---|---|
| Запрет лишних ключей протокола | `extra='forbid'` (ошибка `extra_forbidden`) |
| Ввод и по имени, и по алиасу | `populate_by_name=True` + `alias` |
| Числовой диапазон / regex | `Field(ge=0, le=1)` / `Field(pattern=r'...')` |
| Мутабельный дефолт | `default_factory=list`, не `=[]` |
| Производное поле в JSON | `@computed_field` над `@property` |
| Асимметрия алиасов | `validation_alias` для ввода, `serialization_alias` для вывода |

## Валидаторы

- `@field_validator('a', 'b', mode='after'|'before'|'wrap'|'plain')` — режим по умолчанию `after` (получает значение после приведения типа); `before` получает сырой ввод и полезен для нормализации (strip, dict-коверзия, ISO-строки).
- `@model_validator(mode='after')` — сам объект модели; вернуть обязательно `self`. `mode='before'` получает `dict`-подобный ввод (до создания модели).
- `ValidationInfo.data` в field-валидаторе даёт уже провалидированные предыдущие поля (порядок объявления), `info.context` — сквозной контекст.
- Один валидатор на несколько полей: `@field_validator('f1', 'f2')`; `mode='before'` получает значение каждого поля по очереди.

## Дискриминированные юнионы

Тегированный выбор по полю-дискриминатору: Pydantic читает тег и валидирует ровно одну ветку — быстрее и с точной ошибкой, чем перебор smart-union.

```python
from typing import Annotated, Literal, Union
from pydantic import BaseModel, Field, TypeAdapter, ValidationError

class ChunkFrame(BaseModel):
    type: Literal['chunk'] = 'chunk'
    delta: str
    seq: int = Field(ge=0)

class DoneFrame(BaseModel):
    type: Literal['done'] = 'done'
    total_tokens: int

class ErrorFrame(BaseModel):
    type: Literal['error'] = 'error'
    code: str
    message: str

Frame = Annotated[Union[ChunkFrame, DoneFrame, ErrorFrame], Field(discriminator='type')]
adapter = TypeAdapter(Frame)

obj = adapter.validate_json('{"type":"chunk","delta":"hi","seq":0}')  # ChunkFrame
raw = adapter.dump_json(DoneFrame(total_tokens=42))  # b'{"type":"done","total_tokens":42}'
```

Правила и проверенные факты:

- Тегом служит `Literal[...]` (или enum-тег `Literal[Kind.A]`, не `Kind.A` — иначе `class-not-fully-defined` с предложением `.rebuild()`; значение приводится к `Kind.A`, в модели остаётся enum).
- Ошибки при невалидном теге — `union_tag_invalid` (тег вне списка) и `union_tag_not_found` (ключа-тега нет). Обе — `ValidationError` с полем `loc` на месте юниона.
- Вложенные дискриминированные юнионы работают без ограничений: поле `frame: Frame` внутри модели, включая многоуровневые `Annotated[Union[...], Field(discriminator=...)]` (каждый уровень — свой тег).
- **Aliased discriminator**: тег-поле может иметь `validation_alias`, но алиас обязан быть одинаковым во всех членах юниона, иначе `PydanticUserError ... discriminator-alias` (`Aliases for discriminator 'kind' must be the same`). Для чтения тега из ключа `K` ставьте `Field(validation_alias='K')` каждому члену.
- `TypeAdapter.dump_json` юниона сериализует тег по имени поля по умолчанию; чтобы в JSON был алиас тега — `adapter.dump_json(obj, by_alias=True)`.
- Варианты синтаксиса: поле модели `x: Union[...] = Field(discriminator='t')`, `Annotated[Union[...], Field(discriminator='t')]`, callable-дискриминатор `Discriminator(fn)` для нестандартных тегов.
- JSON Schema юниона автоматически получает `discriminator: {propertyName, mapping}` — готовое описание протокола для клиента.

## Сериализация

| Вызов | Результат |
|---|---|
| `m.model_dump()` | dict, режим `python`: `datetime`/`UUID`/`Enum` остаются объектами |
| `m.model_dump(mode='json')` | dict с JSON-совместимыми типами: строки ISO-8601, UUID-строкой, значением enum |
| `m.model_dump_json()` | JSON-строка (`indent=`, округление до валидного JSON) |
| `TypeAdapter.dump_json(v)` | JSON-строка для юнионов/списков без обёртки-моделью |
| `m.model_dump(include={'id': True, 'user': {'id'}})` | вложенные фильтры; `True` = взять всё |
| `m.model_dump(exclude={'user': {'username', 'password'}})` | исключение по пути; `exclude={'items': {'__all__': {'info'}}}` — для всех элементов списка |
| `m.model_dump(exclude_none=True, exclude_defaults=True, exclude_unset=True)` | гигиеничный wire-формат |
| `m.model_dump(by_alias=True)` | ключи по `alias`/`serialization_alias` |

Проверено: `datetime(2032,6,1,12,13,14)` → `"2032-06-01T12:13:14"`, `UUID` → каноническая строка, `Enum` (в т.ч. `str`-mixin) → его значение (`"a"`). Неподдерживаемый тип в JSON-режиме → `PydanticSerializationError`.

Параметр `round_trip` в v2-доках не описан; roundtrip-паттерн = `validate_json(dump_json(x))` восстанавливает исходный тип ветки юниона (проверено: `ErrorFrame` → bytes → `ErrorFrame`).

## Паттерн «кадры» протокола

Схема стриминга: базовый тег + полезная нагрузка, enum-теги, версионирование.

```python
from enum import Enum
from typing import Annotated, Literal, Union
from pydantic import BaseModel, Field, TypeAdapter
from pydantic import JsonValue

class FrameType(str, Enum):
    CHUNK = 'chunk'
    DONE = 'done'
    ERROR = 'error'

class BaseFrame(BaseModel):
    model_config = ConfigDict(extra='forbid')
    v: int = Field(default=1, ge=1, le=2, description='версия кадра')  # v=2 добавляет поля — отдельные члены юниона

class ChunkFrame(BaseFrame):
    type: Literal[FrameType.CHUNK] = FrameType.CHUNK
    delta: str

StreamFrame = Annotated[Union[ChunkFrame, DoneFrame, ErrorFrame], Field(discriminator='type')]
frames: TypeAdapter[list[StreamFrame]] = TypeAdapter(list[StreamFrame])
batch = frames.validate_json('[{"v":1,"type":"chunk","delta":"a"},{"type":"done","total_tokens":2}]')
log_line = frames.dump_json(batch)  # батч кадров одной строкой
```

- Версионирование: поле `v` в базовой модели + отдельные члены юниона на версию; неизвестная версия отсекается `Literal`-тегом или `v: Literal[1]`.
- Произвольный JSON в payload: аннотация `JsonValue` (рекурсивный union dict/list/str/int/float/bool/None из `pydantic`) — для полей, где структура намеренно свободная.
- Приём потока: `adapter.validate_json` на каждую строку SSE/NDJSON; ошибки тега дают точный `type` (`union_tag_invalid`) и не роняют весь поток.

## Типичные ошибки

- `union_tag_invalid` / `union_tag_not_found` — сервер шлёт тег не из `Literal`; расширяйте Literal или добавляйте fallback-член с тегом-«unknown» и `model_config = ConfigDict(extra='allow')`.
- `PydanticUserError(discriminator-alias)` — разные `validation_alias` тега у членов юниона; выровняйте алиас.
- Enum-тег как `Kind.A` вместо `Literal[Kind.A]` → `class-not-fully-defined`; лечится `Literal[Kind.A]` или `TypeAdapter(...).rebuild()`.
- `model_dump()` в JSON-режиме без `mode='json'`: в dict остаются `datetime`/`UUID`, `json.dumps` падает; используйте `model_dump(mode='json')` или `model_dump_json()`.
- `extra='forbid'` + алиасы: сервер шлёт оба ключа — лишний ключ отбрасывается только при `populate_by_name=True` и явном выборе источника; тестируйте оба формата.
- Мутабельный дефолт `Field(default=[])` — общий список между экземплярами; только `default_factory`.
- `@field_validator` без `@classmethod` — TypeError при сборке схемы (v2 требует classmethod).
- `@computed_field` без `@property` под ним — поле не строится.
- Ожидание `Field(...)`-аргумента `regex=` (v1) — в v2 это `pattern=`; `min_items` → `min_length`.
- `model_config` и `Field` смешаны: `ConfigDict` на уровне модели, `ge/le/pattern` — только в `Field`.

## Документация

- Unions и дискриминированные юнионы: https://docs.pydantic.dev/latest/concepts/unions/
- Сериализация: https://docs.pydantic.dev/latest/concepts/serialization/
- Fields (alias, default_factory, constraints, computed_field): https://docs.pydantic.dev/latest/concepts/fields/
- Валидаторы: https://docs.pydantic.dev/latest/concepts/validators/
- Конфигурация ConfigDict: https://docs.pydantic.dev/latest/api/config/
- TypeAdapter (validate_json/dump_json/json_schema): https://docs.pydantic.dev/latest/api/type_adapter/
- Types (JsonValue): https://docs.pydantic.dev/latest/concepts/types/
