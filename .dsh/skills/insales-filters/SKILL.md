---
name: insales-filters
description: AJAX-фильтры из JS-библиотеки common.v2.js InSales — форма data-ajax-filter на странице категории, lodash-шаблоны групп фильтров (цена, свойства, параметры, картинки, числовые)
whenToUse: При создании или редактировании фильтрации каталога InSales с подгрузкой через AJAX — фильтры по цене, свойствам и характеристикам с шаблонами отрисовки, диапазоны цен, пагинация
---

# AJAX-фильтры (common.v2.js, InSales)

## Принцип работы

Инициализация после `DOMContentLoaded` на странице категории, где есть форма с атрибутом `data-ajax-filter`. Фильтры получаются AJAX-запросом, каждая группа рендерится своим шаблоном и попадает в блок `[data-ajax-filter-items]`.

Параметры формы (значение — JSON-объект):

| Свойство | Назначение |
|---|---|
| `useImages` | `true` — значения свойств выводятся картинками. |
| `visibleItemsSize` | Сколько значений характеристик/свойств показывать сразу (до кнопки «Показать всё»). |
| `maxFilterItems` | `0` — загружать и показывать сразу все характеристики и свойства. |

## Шаблоны

Дерево фильтров: цена → свойства (размер, цвет…) → параметры (материал, сезон…). Для каждой ветки свой шаблон. Шаблоны показаны вложенными только для наглядности зависимости — фактически **каждый шаблон отдельный внутри формы**, ни один не вложен в другой; для корректной работы рекомендуется использовать все:

| Атрибут `<template>` | Назначение |
|---|---|
| `data-ajax-filter-template-price` | Элемент фильтра по цене. |
| `data-ajax-filter-template-item` | Элемент фильтра (группа). |
| `data-ajax-filter-template-usual` | Значения параметров и свойств (чекбоксы). |
| `data-ajax-filter-template-color` | Значения свойств картинками. |
| `data-ajax-filter-template-numeric` | Значения числового параметра (диапазон). |
| `data-ajax-filter-items-template-preloader` | Прелоадер списка характеристик. |

Внутри диапазонов: `data-ajax-filter-range` (обёртка), `data-ajax-filter-range-field-min` / `data-ajax-filter-range-field-max` (инпуты «От»/«До»), имена `price_min` / `price_max`.

## Каркас формы

```liquid
{% assign coll_min = collections[collection.handle].products_price_min | round: 0 %}
{% assign coll_max = collections[collection.handle].products_price_max | round: 0 %}

{% if coll_min == coll_max %}
  {% assign display_filter = false %}
{% endif %}

{% if filter_shown or collection.properties.size > 0 or collection.options.size > 0 %}
  {% assign display_filter = true %}
{% endif %}

{% if collection.current_option_values.size > 0 or collection.current_characteristics.size > 0 %}
  {% assign filter_active = true %}
{% endif %}

{% if price_min or price_max %}
  {% assign filter_active = true %}
{% endif %}

{% if display_filter and collection.products.size > 1 %}
  {% assign display_filter = true %}
{% elsif collection.products.size < 2 and filter_active %}
  {% assign display_filter = true %}
{% else %}
  {% assign display_filter = false %}
{% endif %}

<form
  data-ajax-filter='{ "useImages": "false", "visibleItemsSize": "5" }'
  action="{{ collection.url }}"
  method="get"
>
  <div class="filter__content">
    <div class="filter__head">
      <div class="filter__head-title">Фильтры</div>
    </div>
    <div class="filter__items" data-ajax-filter-items></div>
  </div>

  <div class="filter__controls">
    <button type="submit">Применить</button>
  </div>

  {% if order %}<input type="hidden" name="order" value="{{ order }}" />{% endif %}
  {% if page_size %}<input type="hidden" name="page_size" value="{{ page_size }}"/>{% endif %}
  {% if language.not_default? %}<input type="hidden" name="lang" value="{{ language.locale }}"/>{% endif %}
  {% if search.query != '' %}<input type="hidden" name="q" value="{{ search.query }}"/>{% endif %}

  <!-- все шесть template-блоков; полные исходники — references/filter-templates.md -->
</form>
```

Полные исходники всех шаблонов: [references/filter-templates.md](references/filter-templates.md).

## События

```js
EventBus.subscribe('init-filter:ui-ajax-filter', data => {
  console.log(data);
});
```

## Смежные скилы

- `insales-ajax` — программный `ajaxAPI.collection.get` (фильтры/пагинация коллекции).
- `insales-product` — подключение common.v2.js.
