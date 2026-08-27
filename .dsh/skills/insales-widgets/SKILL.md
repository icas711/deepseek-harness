---
name: insales-widgets
description: Виджеты шаблонов 4 поколения InSales — структура виджета (snippet.liquid/scss/js, messages.json, settings_form.json, settings_data.json, setup.json, info.json), widget_settings и data.blocks, widget-листы, настройки редактора, зависимости
whenToUse: При создании, редактировании или отладке виджетов InSales 4 поколения — разработка виджета (структура папки, настройки в settings_form.json, дефолты в settings_data.json, метаданные info.json), вывод виджетов в шаблоне (widget_lists, widgets_assets), стили через css-переменные layout, JS виджета ($widget, платформенные библиотеки)
---

# Виджеты шаблонов 4 поколения (InSales)

Виджеты — настраиваемые через визуальный редактор блоки контента. Все виджеты шаблона хранятся в папке `widget_types`; виджет — подпапка, имя которой **совпадает с полем `handle` в `info.json`**. Префикс `system_` в названии запрещён.

## Структура виджета

| Файл | Назначение |
|---|---|
| `snippet.liquid` | HTML-разметка (Liquid). |
| `snippet.scss` | Стили (SCSS, БЭМ). |
| `snippet.js` | JS виджета (jQuery, `$widget`, EventBus). |
| `messages.json` | Переводы настроек и текстов виджета. |
| `settings_form.json` | Настройки, отображаемые в редакторе. |
| `settings_data.json` | Значения настроек по умолчанию. |
| `setup.json` | Блоки по умолчанию (для виджетов с блоками). |
| `preview.jpg`, `mobile_preview.jpg` | Превью в галерее виджетов (1280px / 375px). |
| `info.json` | Метаданные: тип, handle, sku, страницы, зависимости. |

Создание: через админку («Настройки → Виджеты» — создать/импортировать с привязкой к шаблону) или добавлением папки в архив шаблона.

## Добавление и вывод

**setup.json шаблона** — виджет ставится по умолчанию при загрузке шаблона:

```json
"theme_widgets": {
  "widget_lists": [
    {
      "name": "index",
      "handle": "index-list",
      "kind": "content",
      "widgets": [
        {
          "settings_data": { "hide-mobile": false, "img-ratio": "3", "autoplay": false, "autoplay-delay": "5" },
          "widget_type": "system_widget_v4_promo_slider_4",
          "data_handle": "block-list-slider"
        }
      ]
    }
  ]
}
```

Виджет-листы разделяют области страницы: список главной (`index-list`) отличается от списков футера/шапки — на каждой странице основный контент отделён от header/footer.

**Редактор сайта** — кнопка `+` в области редактирования или боковая панель → галерея виджетов; размещённый виджет автоматически попадает в setup.json при скачивании архива.

**Вывод в шаблоне:**

```liquid
{% for widgetDrop in widget_lists.index-list.widgets %}
  {% widget widgetDrop %}
{% endfor %}
```

Стили и скрипты виджетов — отдельным тегом со списком виджет-листов через запятую:

```liquid
{% widgets_assets "header-list, footer-list, index-list" %}
```

## snippet.liquid

Код виджета оборачивается в `div.layout` с уникальным классом виджета; при изменении настроек в редакторе у родителя меняются css-переменные в `style`.

- Настройки виджета: `{{ widget_settings.<name> }}` (name из settings_form.json); дефолт темы: `| default: settings.<name>`.
- Блоки (виджеты с блоками): `{% for block in data.blocks %}{{ block.name }}{% endfor %}`.
- Переводы из messages.json: `{{ widget_messages.<ключ> }}`.
- Отладка: `{% help %}` — доступные переменные страницы; `{% help account %}` — свойства объекта.
- Медиа-фильтры: `image_url` (`{{ image | image_url: 940, format: 'webp', resizing_type: 'fit_width' }}`), `video_iframe_by_url` (`id: video_id`), `video_preview_by_url`.

Пример адаптивной галереи с `<picture>` + lazyload — [references/snippet-examples.md](references/snippet-examples.md).

## snippet.scss

SCSS + БЭМ. Уникальный родительский класс виджета — символ `&`:

```scss
& {
  border-bottom: 1px solid var(--bg-minor-shade);
  position: relative;
}

&[style*="--article-hide-photo:true"] {
  .article-photo { display: none !important; }
}
```

Родительский `.layout` получает css-переменные настроек: `style="--layout-wide-bg:true; --layout-pt:2vw; --hide-desktop:false; ..."`. Состояния комбинируются: `&[style*="--hide-favorites:true"][style*="--hide-personal:false"] { ... }`.

На страницах с виджетами подключается `core.css` — готовые стили с css-переменными (шрифты, цвета кнопок), значения которых можно использовать или переопределять:

```scss
& {
  --grid-list-min-width: 190px;
  @media screen and (max-width: 767px) {
    --grid-list-min-width: 50%;
  }
}
```

## snippet.js

Доступны jQuery и EventBus. Переменная `$widget` содержит **все копии виджета на странице** — обязательно перебирать через `each`:

```js
$widget.each(function(index, el) {
  new LazyLoad({ container: $(el).get(0), elements_selector: '.lazyload' });
});
```

События common.v2.js доступны напрямую (каталог — скил `insales-render`); в `data.action` приходит jQuery-объект затронутого компонента. Зависимости — только платформенные (список в `libraries` info.json ниже): свой node_modules подключить нельзя.

## messages.json

Переводы по языкам (`ru`, `ua`, `en`, `es`); ключи используются в snippet.liquid и settings_form.json:

```json
{
  "ru": { "youtube_link": "Ссылка youtube, vimeo", "youtube_link_help": "Ссылка из вкладки встроить" },
  "en": { "youtube_link": "Youtube, vimeo link", "youtube_link_help": "Link from the embed tab" }
}
```

Зарезервированные ключи для виджетов с блоками: `blocks` (заголовок над списком блоков), `block` (кнопка «добавить», например «Категорию»), `block_list` (название списка).

## settings_form.json

Группы → подгруппы → items:

```json
{
  "Группа 1": [
    { "group_name": "Подгруппа 1", "items": [ ... ] },
    { "group_name": "Подгруппа 2", "items": [ ... ] }
  ],
  "Группа 2": []
}
```

Одна группа — заголовок не выводится, дроп раскрыт. Общие параметры любого поля: `name` (уникальный идентификатор), `label`, `value` (дефолт), `help`, `type`, плюс:

| Параметр | Назначение |
|---|---|
| `general` (bool) | Вывести настройку в основные в редакторе. |
| `general_position` (number) | Порядок в основных настройках. |
| `general_label` | Заголовок с переводом (`"{{ messages.title }}"`). |
| `enable_server_reload` (bool) | Перезагрузка шаблона при изменении значения. |
| `hide_mobile` (bool) | Скрыть настройку в мобильной версии редактора. |

### Типы полей

| Тип | Спец-параметры |
|---|---|
| `text` | — |
| `rich-text` (основной текст) | — |
| `number` | `min`, `max`, `step`, `with_btns` (кнопки +/−), `class: "range"`. |
| `checkbox` | — |
| `select` | `options: [["OpenSans", "google:Open+Sans"], ["Roboto", "google:Roboto"]]` (название, значение). |
| `range` | `min`, `max`, `step`, `unit` (`"vw"`, `"px"`), `with_btns`, `class: "range"`. |
| `button-group` | `options: [{ "value": "left", "title": "{{ messages.align_left }}", "icon": "mdi-text-align-left" }]`. |
| `file` | `with-generate-logo` (генератор логотипов). |
| `color` | `clearable`, `fallback` (`"color-btn-bg"` / `"bg"` — цвет, если не указан). |
| `blog` | `edit_admin_link` (например, `product_options`). |

Чтение значения в liquid: `{{ widget_settings.<name> }}`.

## Чтение widget_settings в snippet.liquid (эмпирически, на живом магазине)

Парсер Liquid InSales в сниппетах виджетов капризен к ключам с дефисом и к операциям
над значениями. Рабочие и нерабочие паттерны (проверено серией debug-выводов):

**Единственный надёжный способ** — прямой вывод с bracket-ключом, без переменных
и без фильтров, в том числе прямо в атрибутах:

```liquid
<img src="{{ widget_settings['step-1-image'] }}" alt="{{ widget_settings['step-1-title'] }}">
{% if widget_settings['member-1-name'] != blank %} ... {% endif %}
```

Дефисы и цифры в имени настройки (`step-1-image`, `member-3-name`) в bracket-записи
допустимы. Проверка `!= blank` работает и используется для опциональных полей.

**Не работает / роняет рендер** (ошибки при этом НЕ выбрасываются — тихая пустота
или обрыв вывода):

- точечная запись с дефисом: `widget_settings.step-1-image` — парсится как вычитание,
  синтаксическая ошибка;
- `{% assign x = widget_settings['key'] %}` → `{{ x }}` в src — пусто (прямым выводом
  значение печатается, через переменную не доезжает); проверка `x.size == 0` как дефолт
  на file-настройках не срабатывает;
- `capture`, `| default:`, `| strip` над такими значениями — пустота либо обрыв
  рендера секции сразу после открывающего тега.

**Дефолты** не подставлять фильтром: редактор при добавлении виджета сам проставляет
`value` из settings_form.json в поля экземпляра.

**Запасной обход**: платформа дублирует все настройки в css-переменные обёртки виджета
(`<div class="layout widget-type_..." style="--step-1-image:'https://...';">`) — если
Liquid-чтение сломалось, snippet.js может читать
`getComputedStyle(el).getPropertyValue('--step-1-image')` и подставлять в `img.src`.

**Деплой кода виджета**: правка snippet.liquid через «Настройки → Виджеты» применяется
к рендеру не сразу; надёжное обновление — пересоздать экземпляр виджета на странице
(удалить и добавить заново через редактор сайта).

## settings_data.json

Дефолты настроек; допустимые типы по `type` поля:

| type | Значение |
|---|---|
| `text` | строка (`"left"`) или мультиязычный объект (`{"ru": "Текст", "en": "Text"}`). |
| `number` | число (`2`). |
| `checkbox` | `true` / `false`. |
| `color` | `"#ffffff"` (RGB-строка). |

```json
{
  "layout-wide-bg": true,
  "layout-pt": 2,
  "img-ratio": 2,
  "banner-text-color": "#ffffff",
  "title": { "ru": "Преимущества", "en": "Benefits" }
}
```

## setup.json (в виджете)

Заполняется при `type: blockListWidgetType` и заданном `block_template_handle`:

```json
{
  "blocks": [
    { "name": "Широкий ассортимент", "description": "..." },
    { "name": "Всегда свежие", "description": "..." }
  ]
}
```

## info.json

```json
{
  "type": "BlockListWidgetType",
  "handle": "system_widget_v4_stories_3",
  "sku": "ES2",
  "page_kinds": ["all"],
  "widget_list_kinds": ["before_content", "content", "after_content", "footer"],
  "generation": 4,
  "name": { "ru": "Истории", "en": "Stories" },
  "description": { "ru": "...", "en": "..." },
  "widget_category_handle": "stories",
  "libraries": ["fslightbox", "jquery", "splide3", "my-layout", "vanilla-lazyload"],
  "block_template_handle": "system-image-link-text"
}
```

| Поле | Значения |
|---|---|
| `generation` | `4`. |
| `type` | `SimpleWidgetType` (без блоков) / `blockListWidgetType` (с блоками + setup.json; пользователь добавляет и двигает блоки в редакторе). |
| `handle` | = имя папки виджета; уникальный, любое наименование. |
| `sku` | Артикул из заглавных латинских букв и цифр (F — footer, M — medium, 1 — номер в группе). Правка кода в редакторе шаблона добавляет точку (`FM1.1`); коллизия — тире (`FM1-1`). |
| `page_kinds` | `all`, `index`, `collection`, `product`, `cart`, `page`, `search`, `blog`, `compare`, `article`, `favorite`. |
| `widget_list_kinds` | `top_panel`, `header`, `content`, `footer`, `bottom_panel`, `outside`, `sidebar` (также встречаются `before_content`, `after_content`). |
| `widget_category_handle` | Категория галереи: `banner`, `sliders`, `product-info`, `products-cards`, `cart`, `navigation`, `filters`, `forms`, `headers`, `footers`, `benefits`, `text`, `video`, `stories`, `reviews`, `blog`, `articles`, `modals`, `notices`, `delimeters`, `page-title`, `search-results`, `compare`, `favorites`, `drugie`, `collection-description`, `collection-subcollections`, `collection-products`, `product-similar`, `product-related`, `product-sidebar`, `product-homepage`, `recently-viewed`, `comments`. |
| `block_template_handle` | Шаблон полей блоков: существующий (`system-banner-2`) или свой из «Настройки → Настройки сайта → Шаблоны блоков» (поля: название рус., идентификатор латиницей, тип). |
| `libraries` | Только платформенные зависимости: `commonjs_v2`, `jquery`, `microalert`, `my-layout`, `vanilla-lazyload`, `splide`, `splide3`, `fslightbox`, `micromodal`, `body-scroll-lock`, `js-cookie`, `cut-list`, `nouislider`. |

## Смежные скилы

- `insales-product`, `insales-cart` и др. — содержимое виджетов, использующее common.v2.js (`libraries: ["commonjs_v2"]`).
- `insales-render` — EventBus (события, доступные в snippet.js) и lodash-шаблоны для рендера данных внутри виджета.
