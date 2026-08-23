# Виджеты шаблонов 4 поколения InSales (сырая документация, часть 7)

Источник: официальная документация InSales, скопировано пользователем.

Виджеты — настраиваемые через редактор блоки с контентом. Папка виджета кладётся в widget_types,
имя папки = полю handle в info.json. Префикс system_ запрещён.

Структура: snippet.liquid, snippet.scss, snippet.js, messages.json, settings_form.json,
settings_data.json, setup.json, preview.jpg + mobile_preview.jpg, info.json.

Создание: через админку (Настройки → Виджеты, создать/импортировать, привязка к шаблону) или
добавлением папки в архив шаблона.

Добавление: через setup.json (theme_widgets.widget_lists[], виджет-листы разделяют области
страниц: index-list отличается от футера/хедера) или через визуальный редактор (+ / боковая
панель, галерея виджетов; при скачивании архива записывается в setup.json автоматически).

Вывод: {% for widgetDrop in widget_lists.index-list.widgets %}{% widget widgetDrop %}{% endfor %}.
Стили/скрипты: {% widgets_assets "header-list, footer-list, index-list" %}.

## snippet.liquid

- HTML виджета оборачивается в div.layout + уникальный класс виджета; при изменении настроек
  редактором меняются css-переменные в атрибуте style родителя.
- Настройки: {{ widget_settings.<name> }} (name из settings_form.json), напр.
  widget_settings.layout-wide-content. Дефолт: | default: settings.<name>.
- Блоки (у blockListWidgetType): {% for block in data.blocks %}{{ block.name }}{% endfor %}.
- Переводы: widget_messages.<ключ>.
- Отладка: {% help %} — доступные переменные; {% help account %} — свойства объекта.
- Фильтры медиа: image_url (ширина, format: 'webp', resizing_type: 'fit_width'),
  video_iframe_by_url (id:), video_preview_by_url.

## snippet.scss

SCSS + БЭМ. Уникальный родительский класс виджета — символ &:
& { ... }; состояния настроек: &[style*="--article-hide-photo:true"] { ... }.
Родитель .layout получает style с css-переменными (--layout-wide-bg, --layout-pt, --hide-desktop,
--hide-mobile и т.п.). На страницах с виджетами подключается core.css со стилями и переменными
(шрифты, цвета кнопок); можно задавать/переопределять переменные вида --grid-list-min-width.

## snippet.js

Доступны jQuery и переменная $widget (все копии виджета на странице) — перебирать через
$widget.each(function(index, el) { ... }). Доступен EventBus (subscribe/publish). Зависимости —
только платформенные (см. libraries в info.json).

## messages.json

Переводы по языкам ru/ua/en/es: ключ → перевод. Ключи используются в snippet.liquid,
settings_form.json (label/help через {{ messages.<ключ> }}? — в виджете widget_messages).
Зарезервированные ключи для блоков: blocks (заголовок над списком), block (кнопка «добавить»),
block_list (название списка).

## settings_form.json

Группы настроек: { "Группа 1": [], "Группа 2": [], "Группа 3": [] }; подгруппы: элементы
{ "group_name": "...", "items": [...] } (или без group_name — { "items": [...] }).
Параметр general: true — вывод в основные настройки; general_position — порядок;
general_label — заголовок с переводом; enable_server_reload — перезагрузка шаблона при изменении;
hide_mobile — скрыть в мобильном редакторе.

Типы полей: text, rich-text, number (min/max/step/with_btns, class: "range"), checkbox, select
(options: [["OpenSans","google:Open+Sans"],...]), range (min/max/step/unit/with_btns),
button-group (options: [{value,title,icon:"mdi-..."}]), file (with-generate-logo), color
(clearable, fallback: "color-btn-bg"|"bg"), blog (edit_admin_link).
Общий набор параметров: name (уникальный), label, value, help, type.

Значение настройки: {{ widget_settings.<name> }} (в доках есть пример с двоеточием
widget_settings:font_family — вероятно опечатка).

## settings_data.json

Дефолты настроек из settings_form.json. Типы: text→string, number→number, checkbox→boolean,
color→"#RGB", мультиязычный текст→{"ru":...,"en":...}. Примеры: layout-wide-bg: true,
img-ratio: 2, banner-text-color: "#ffffff", button-text: {...}.

## setup.json (в виджете)

Для blockListWidgetType с block_template_handle: { "blocks": [ { "name": ..., "description": ... } ] }.

## preview.jpg

preview.jpg (десктоп, рекомендуемая ширина 1280px), mobile_preview.jpg (375px).

## info.json

- generation: 4.
- type: "SimpleWidgetType" | "blockListWidgetType" (второй — setup.json с блоками, пользователь
  добавляет/двигает блоки в редакторе).
- handle: совпадает с папкой; уникальный, любое наименование.
- sku: уникальный артикул из заглавных латинских букв и цифр (F - footer, M - medium, 1 - номер);
  при изменении кода в редакторе добавляется точка (FM1.1), при коллизии — тире (FM1-1).
- page_kinds: all, index, collection, product, cart, page, search, blog, compare, article,
  favorite.
- widget_list_kinds: top_panel, header, content, footer, bottom_panel, outside, sidebar
  (в примере также before_content, after_content).
- widget_category_handle: категории — product-similar, banner, blog, modals, drugie, page-title,
  product-info, products-cards, comments, cart, navigation, collection-description, reviews,
  footers, collection-subcollections, benefits, delimeters, search-results, sliders,
  product-related, compare, text, collection-products, product-sidebar, product-homepage,
  notices, filters, forms, headers, recently-viewed, favorites, articles, video, stories.
- block_template_handle: существующий (system-banner-2) или свой (Настройки → Настройки сайта →
  Шаблоны блоков; поля: название-рус, идентификатор-латиница, тип).
- libraries: только платформенные — commonjs_v2, jquery, microalert, my-layout, vanilla-lazyload,
  splide, splide3, fslightbox, micromodal, body-scroll-lock, js-cookie, cut-list, nouislider.
- name/description: мультиязычные объекты.

Пример info.json (см. скил): BlockListWidgetType, handle system_widget_v4_stories_3, sku ES2,
page_kinds ["all"], widget_list_kinds, libraries, block_template_handle system-image-link-text.
