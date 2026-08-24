---
name: rag-stack
description: RAG-стек на bge-m3 и Qdrant — чанкинг, dense и sparse эмбеддинги, named vectors, гибридный поиск с RRF и BM25-idf, реранк bge-reranker-v2-m3 и цитирование по chunk-id
whenToUse: "Когда строишь или отлаживаешь RAG-пайплайн: чанкинг документов, выбор эмбеддинг-модели (bge-m3, e5), коллекции и поиск Qdrant, гибридный dense+sparse поиск, реранк и цитирование источников"
---

# RAG-стек: чанкинг → эмбеддинги → Qdrant → гибридный поиск → реранк → цитирование

Плотный справочник по пайплайну retrieval-augmented generation. Параметры Qdrant и модели BAAi/e5 проверены по официальной документации (qdrant.tech/documentation, huggingface.co/BAAi, huggingface.co/intfloat) и курсу Qdrant.

## Чанкинг

| Стратегия | Как работает | Минусы |
|---|---|---|
| Fixed size | Равные куски по символам/словам с overlap | Режет предложения, теряет смысл |
| Recursive character | Режет по `\n\n` → `\n` → `. ` → ` `, пока кусок влезает в `chunk_size` | Размер кусков варьируется |
| Token-based (+overlap) | По токенам токенизатора модели | Нужен токенизатор; медленнее |
| Sliding window | Окно фиксированной длины, шаг меньше размера | Дублирование × (1/(1−overlap)) |
| Semantic | Разрез там, где меняется смысл (по эмбеддингам предложений) | Дорого: эмбеддинг каждого предложения |

Влияние размера на поиск: мелкие чанки (128–512 токенов) точнее матчат короткие запросы, но теряют контекст темы; крупные (1024+) держат тему, но «размывают» dense-вектор (семантическое усреднение) и хуже матчатся точечно. Курс Qdrant: overlap 10–20% — баланс (25–50% — high-recall, 0% — экономия хранения).

Размер под модель:

- **bge-m3**: контекст 8192 токенов — предел, а не цель; для retrieval обычно 256–1024 токена на чанк (длиннее — дороже реранк и размытее вектор).
- **e5 / multilingual-e5**: максимум 512 токенов, длиннее — тихая усечка и потеря хвоста; чанки строго меньше 512, с запасом на спец-токены.

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=800, chunk_overlap=120,    # дефолты TextSplitter 4000/200 — для LLM, не для эмбеддингов
    separators=["\n\n", "\n", ". ", " ", ""],
    length_function=len,                  # или токен-каунтер модели
)
chunks = splitter.split_text(doc_text)
```

`RecursiveCharacterTextSplitter(separators=None, keep_separator=True|'start'|'end', is_separator_regex=False, **kwargs)`; `chunk_size`/`chunk_overlap`/`length_function` наследуются от `TextSplitter`. Ручной чанкинг уместен, когда нужны полный контроль метаданных и спанов.

Метаданные чанка (payload точки Qdrant): `doc_id`, `chunk_idx`, `span` — `[start, end)` в исходном тексте (цитаты и подсветка), `headings` — хлебные крошки заголовков, `source` — ссылка для списка источников, `lang`. Пример payload — в разделе Upsert.

## Эмбеддинги

### bge-m3 (BAAi)

Мультиязычная модель, dense-вектор 1024, контекст до 8192 токенов. Multi-functionality: из одного `encode` — dense retrieval, sparse (lexical-веса токенов, аналогично BM25) и multi-vector (ColBERT).

```python
from FlagEmbedding import BGEM3FlagModel

model = BGEM3FlagModel('BAAI/bge-m3', use_fp16=True)  # fp16 быстрее, чуть ниже качество
out = model.encode(
    ['текст запроса', 'текст документа'],
    max_length=8192,                 # меньше = быстрее
    return_dense=True, return_sparse=True, return_colbert_vecs=False,
)
dense = out['dense_vecs']            # (N, 1024)
sparse = out['lexical_weights']      # список dict {token_id: weight}
toks = model.convert_id_to_token(sparse[0])
lex_score = model.compute_lexical_matching_score(sparse[0], sparse[1])

scores = model.compute_score(sentence_pairs, weights_for_different_modes=[0.4, 0.2, 0.4])
# w[0]*dense + w[1]*sparse + w[2]*colbert
```

- Sparse-веса для Qdrant: `{int(token_id): float(weight)}` → `models.SparseVector(indices=list(ids), values=list(vals))`.
- Dense bge-m3 используется с cosine similarity.

### e5 / multilingual-e5 (intfloat)

Префиксы **обязательны**: `'query: '` для запросов, `'passage: '` для документов (симметричные задачи — `query:` у обоих); без префикса качество деградирует.

- `intfloat/multilingual-e5-large`: 24 слоя, эмбеддинг 1024, максимум 512 токенов (усечение).
- Карточка: `tokenizer(..., max_length=512, padding=True, truncation=True)` + `F.normalize(embeddings, p=2, dim=1)`; в sentence-transformers — `model.encode(texts, normalize_embeddings=True)`.
- После L2-нормализации косинус = скалярное произведение; в Qdrant для нормализованных векторов `Cosine` и `Dot` дают одинаковый порядок.

## Qdrant

### Коллекция: dense + sparse named vectors

```python
from qdrant_client import QdrantClient, models

client = QdrantClient(url='http://localhost:6333')
client.create_collection(
    collection_name='docs',
    vectors_config={
        'dense': models.VectorParams(size=1024, distance=models.Distance.COSINE),  # bge-m3
    },
    sparse_vectors_config={
        'text-sparse': models.SparseVectorParams(modifier=models.Modifier.IDF),
    },
)
```

- Дефолтный dense: `VectorParams(size, distance)`; именованные: dict `{name: VectorParams}` — у каждого своя size/distance.
- Для sparse-векторов дистанция всегда `Dot` (не настраивается); `SparseVectorParams()` без модификатора валиден.
- `modifier='idf'` пересчитывает веса запроса по IDF шарда: `IDF(q_i) = ln((N − n(q_i) + 0.5)/(n(q_i) + 0.5) + 1)` — редкие термины весят больше (BM25-стиль). IDF не предвычислим при streaming-инференсе, поэтому включается в конфиге коллекции.

### Payload-индексы

```python
client.create_payload_index('docs', field_name='doc_id',
                            field_schema=models.PayloadSchemaType.KEYWORD)
client.create_payload_index('docs', field_name='group_id',
                            field_schema=models.PayloadSchemaType.KEYWORD, is_tenant=True)
client.create_payload_index('docs', field_name='chunk_idx',
                            field_schema=models.PayloadSchemaType.INTEGER)
```

Типы: `keyword` (Match), `integer` (Match+Range), `float`, `bool`, `geo`, `datetime` (Range, v1.8+), `text` (полнотекст). `is_tenant=True` (v1.11+) ко-лоцирует векторы тенанта — быстрее чтение при payload-мультитенантности. Индексы создавать до инжеста.

### Upsert

```python
client.upsert('docs', points=[
    models.PointStruct(
        id='43cf51e2-8777-4f52-bc74-c2cbde0c8b04',  # u64 или UUID
        vector={
            'dense': dense_list,
            'text-sparse': models.SparseVector(indices=[119, 3360], values=[0.71, 0.13]),
        },
        payload={'doc_id': 'manual-42', 'chunk_idx': 7, 'span': [1234, 2109],
                 'headings': ['Установка', 'Linux'], 'source': 'https://…', 'lang': 'ru'},
    ),
])
```

Upsert по существующему ID заменяет точку целиком. Большие объёмы — батчами (batch-операции / column-oriented upload).

### Query API: nearest, фильтры, score_threshold

```python
hits = client.query_points(
    'docs',
    query=dense_query_vector,   # именованный dense; обёртки NearestQuery и др. тоже допустимы
    using='dense',
    limit=10,
    score_threshold=0.5,        # для Cosine — в [0, 1]
    query_filter=models.Filter(
        must=[models.FieldCondition(key='doc_id', match=models.MatchValue(value='manual-42'))],
    ),
    with_payload=['doc_id', 'chunk_idx', 'span', 'source', 'text'],
).points
```

- `using` выбирает именованный вектор; `query=` принимает вектор, `NearestQuery`, `SparseVector`, `Document` (server-side inference).
- `query_filter` (`must`/`should`/`must_not`) применяется до ANN; поля фильтра должны быть проиндексированы.
- `SearchParams(hnsw_ef=..., exact=False, indexed_only=...)`: `exact=True` — полный скан и стабильный порядок (нужен offset-пагинации).
- `with_payload` — `True` / список полей / include-exclude selector.

### Scroll

```python
offset = None
while True:
    points, offset = client.scroll('docs', limit=256, offset=offset,
                                   scroll_filter=models.Filter(must=[...]),
                                   with_payload=True, with_vectors=False)
    if not points or offset is None:
        break   # next_page_offset None → последняя страница
```

Порядок без `exact` не гарантирован. `order_by='timestamp'` сортирует по payload-полю (нужен Range-индекс) и отключает offset-пагинацию.

### Мультитенантность через payload-фильтры

Тенант — payload-поле `group_id` (keyword + `is_tenant=True`); изоляция — фильтром в каждом запросе: `must=[FieldCondition(key='group_id', match=MatchValue(value='user_1'))]`. При sparse+IDF статистика по умолчанию на весь шард и смешивает тенантов — задавайте `idf=<Filter>` в параметрах поиска (корпус IDF = один тенант). Сильнее изоляция — user-defined sharding (shard на тенанта) или tiered multitenancy.

## Гибридный поиск

Пайплайн: candidate generation (dense + sparse параллельно) → fusion (RRF/DBSF) → rerank.

```python
results = client.query_points(
    'docs',
    prefetch=[                                         # кандидаты
        models.Prefetch(query=dense_vec, using='dense', limit=50),
        models.Prefetch(query=models.SparseVector(indices=sidx, values=sval),
                        using='text-sparse', limit=50),
    ],
    query=models.RrfQuery(rrf=models.Rrf()),           # RRF-слияние рангов
    limit=10,
).points
```

- Query API (v1.10+): `prefetch` — суб-запросы, главный query применяется к объединению их результатов; prefetch вкладывается в prefetch.
- **RRF**: `score(d) = Σ 1/(k + rank)`; константа `k` по умолчанию **2** (`models.Rrf(k=60)` — переопределить); взвешенный RRF — `models.Rrf(weights=[3.0, 1.0])`, число весов = числу prefetch. **DBSF** — `models.FusionQuery(fusion=models.Fusion.DBSF)`, нормализация распределений score. Ранговая Fusion не зависит от шкал (Cosine ∈ [0,1] против неограниченного BM25) — потому RRF безопаснее линейной смеси с alpha.
- `offset` главного запроса применяется после fusion; prefetch-ам нужен `limit ≥ limit + offset` главного, иначе пусто.
- BM25-ветка гибрида: либо sparse-веса bge-m3 + `Modifier.IDF`, либо server-side BM25-вектор (`model: 'qdrant/bm25'`, `Document`-инференс).
- Финальный top-k — после реранка кандидатов fusion.

## Реранк

```python
from FlagEmbedding import FlagReranker

reranker = FlagReranker('BAAI/bge-reranker-v2-m3', use_fp16=True)
pairs = [[query, hit.payload['text']] for hit in results]   # топ-K после fusion
raw = reranker.compute_score(pairs)                   # логиты: выше = релевантнее
probs = reranker.compute_score(pairs, normalize=True) # sigmoid → [0, 1]
top = sorted(zip(results, probs), key=lambda p: p[1], reverse=True)[:5]
```

- bge-reranker-v2-m3 — лёгкий мультиязычный кросс-энкодер (XLM-RoBERTa; в карточке пример токенизации `max_length=512`); рекомендован BAAi для мультиязычных задач.
- Кросс-энкодер точнее би-энкодера, но O(пар) — реранкуйте только кандидатов (обычно 20–100).
- `normalize=True` — калиброванная уверенность для порога «нет релевантных».

## Цитирование

Правило: утверждение в ответе допустимо только при опоре на конкретный релевантный чанк.

```python
cited = top[:5]  # chunk-id = point id; span и source уже в payload
context_block = '\n\n'.join(f'[{i+1}] {h.payload["text"]}' for i, h in enumerate(cited))
# → в промпт: «отвечай, ссылаясь [n] на фрагменты»
sources = [f'[{i+1}] {h.payload["source"]} — фрагмент {h.payload["chunk_idx"]} '
           f'(символы {h.payload["span"][0]}–{h.payload["span"][1]})'
           for i, h in enumerate(cited)]
```

Границы: маркер `[n]` — только к утверждению, действительно выведенному из чанка n; в списке источников нет чанков без использованных утверждений; нет чанков выше порога — честный отказ («в базе нет релевантного фрагмента»), не генерация по памяти. `span` даёт точную цитату и подсветку в UI.

## Типичные ошибки

- Префиксы e5 забыты → тихая деградация recall; запрос всегда `'query: '`, документ `'passage: '`.
- Чанки под e5 длиннее 512 токенов — молчаливая усечка; под bge-m3 агрессивные 256 — потеря темы; `chunk_size=4000` (дефолт langchain) не влезет ни в одну модель — задавайте явно.
- `VectorParams.size` ≠ размерности модели — upsert/search падают с ошибкой размерности.
- Sparse-запрос без `using='text-sparse'` — поиск пойдёт не по тому вектору.
- RRF с prefetch `limit` < `limit + offset` главного — пустой результат.
- Линейная смесь raw-score dense и sparse с alpha — доминирование одной шкалы; RRF/DBSF или нормализация.
- Фильтр по непроиндексированному payload — полный скан и латентность; индексы до загрузки данных.
- Реранк всего корпуса вместо топ-K — на порядки дороже поиска.
- `compute_score` с одной парой возвращает скаляр, не список.
- Мультитенантность фильтром при включённом IDF смешивает статистики тенантов — задавайте `idf`-фильтр.

## Документация

- Qdrant: collections и vectors config — https://qdrant.tech/documentation/concepts/collections/ и https://qdrant.tech/documentation/concepts/vectors/
- Qdrant: поиск и Query API — https://qdrant.tech/documentation/search/search/
- Qdrant: гибридные запросы, RRF/DBSF, prefetch — https://qdrant.tech/documentation/search/hybrid-queries/
- Qdrant: payload-индексы и IDF modifier — https://qdrant.tech/documentation/manage-data/indexing/
- Qdrant: точки, upsert, scroll — https://qdrant.tech/documentation/manage-data/points/
- Qdrant: мультитенантность и per-tenant IDF — https://qdrant.tech/documentation/manage-data/multitenancy/
- BAAi/bge-m3 (карточка модели) — https://huggingface.co/BAAi/bge-m3
- BAAi/bge-reranker-v2-m3 — https://huggingface.co/BAAi/bge-reranker-v2-m3
- intfloat/multilingual-e5-large — https://huggingface.co/intfloat/multilingual-e5-large
- LangChain text splitters — https://reference.langchain.com/python/langchain-text-splitters/character/RecursiveCharacterTextSplitter
- Курс Qdrant: chunking strategies — https://qdrant.tech/course/essentials/day-1/chunking-strategies/
