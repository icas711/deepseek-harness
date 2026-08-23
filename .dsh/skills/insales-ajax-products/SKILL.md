---
name: insales-ajax-products
description: Компоненты AJAX-товары из common.v2.js InSales — ui-ajax-product (подгрузка одного товара по ID с полной карточкой) и ui-ajax-products (список превью товаров из категории), шаблоны отрисовки, imageResizingRules, события
whenToUse: При AJAX-подгрузке товаров на страницах InSales — полная карточка товара по ID в модальном окне или блоке, список превью товаров из категории (слайдеры, блоки «похожие товары»), адаптивные изображения через imageResizingRules
---

# AJAX-товары: ui-ajax-product и ui-ajax-products (common.v2.js, InSales)

Два компонента для получения товаров AJAX-запросом:

- **ui-ajax-product** — один конкретный товар с полной информацией (карточка: галерея, описания, варианты, параметры, комплект).
- **ui-ajax-products** — товары категории в виде превью.

Готовые примеры — виджеты SP9, SP12, SP16 шаблонов 4 поколения. Общие понятия (подключение, EventBus) — скил `insales-product`.

## ui-ajax-product

### Разметка и настройки

```liquid
<div data-ajax-product='{
    "productId": "00000000",
    "productData": ["variants", "short_description", "price_kinds", "first_image", "images", "properties", "characteristics", "option_names", "bundle_info", "video_links"],
    "initOnLoadPage": "true",
    "imageResizingRules": [
          {"size": "1000", "format": "webp", "resizing_type": "fit_width", "quality": "100"},
          {"size": "500", "format": "webp", "resizing_type": "fit_width", "quality": "100"},
          {"size": "1000", "resizing_type": "fit_width", "quality": "100"}
    ],
    "videoBeforeImage": "false",
    "videoLinksDetails": "true"
}'>
    <!-- шаблоны -->
</div>
```

| Настройка | Назначение |
|---|---|
| `productId` | ID товара в InSales. |
| `productData` | Массив строк — какие данные получить (список ниже). |
| `initOnLoadPage` | Автоинициализация после DOMContentLoaded. |
| `imageResizingRules` | Правила ресайза изображений (`size`, `format`, `resizing_type`, `quality`). |
| `videoBeforeImage` | Видео перед изображениями. |
| `videoLinksDetails` | Детали о видео (iframe, превью); рекомендуется всегда `true`. |

`productData` по умолчанию (без передачи): URL, название, наличие, единицы измерения, мин./макс. цена. Дополнительно: `variants`, `short_description`, `description`, `price_kinds`, `first_image`, `images`, `properties`, `characteristics`, `option_names`, `bundle_info`, `video_links`. **Для работы атрибута/шаблона соответствующее поле должно быть в `productData`** (стикеры — `properties`+`characteristics`; галерея — `images`+`video_links`; селектор вариантов — `variants`; комплект — `bundle_info`).

### Инициализация

Автоматическая — `initOnLoadPage: true`. Ручная — записать настройки в `dataset.ajaxProduct` и опубликовать событие с DOM-элементом:

```js
const ajaxProductNodes = Array.from(document.querySelectorAll('[data-ajax-product]'));
ajaxProductNodes.forEach(node => {
  node.dataset.ajaxProduct = JSON.stringify({ productId, productData: [...], /* ... */ });
  EventBus.publish('ui-ajax-product:load-product', node);
});

// После загрузки и отрисовки товара
EventBus.subscribe('init-product:ui-ajax-product', function (data) {
  FavoritesProducts.update(); // если есть кнопка избранного
  Compare.update();           // если есть кнопка сравнения
  // например, инициализация галереи
});
```

### Шаблоны

Каждый шаблон — отдельный фрагмент внутри `data-ajax-product` (вложенность в списке только показывает связь):

| `<template>` атрибут | Назначение |
|---|---|
| `data-ajax-product-template` | Карточка; внутри обязательна форма `data-ajax-product-form`. |
| `data-ajax-product-gallery-template` | Галерея фото и видео (если изображений/видео > 1). |
| `data-ajax-product-one-photo-template` | Единственное фото (1 изображение, нет видео). |
| `data-ajax-product-short-description-template` | Краткое описание (текст в `...-item-text`). |
| `data-ajax-product-full-description-template` | Полное описание (текст в `...-item-text`). |
| `data-ajax-product-properties-template` | Параметры и значения. |
| `data-ajax-product-bundle-components-item-template` | Компонент комплекта. |
| `data-ajax-product-bundle-components-item-options-template` | Свойства компонента комплекта. |

Полные исходники всех шаблонов: [references/ajax-product-templates.md](references/ajax-product-templates.md).

### Атрибуты формы (data-ajax-product-form)

| Атрибут | Назначение |
|---|---|
| `data-ajax-product-title` / `-link` / `-unit` | Название в textContent / href на товар / единицы измерения. |
| `data-ajax-product-stickers` | Стикеры (параметр с handle `label`); внутри можно `data-product-card-sale-value`. |
| `data-ajax-product-sizes-table-btn="Размер,Size"` | Удаляет элемент, если нет варианта с таким свойством (кроме комплектов). |
| `data-ajax-product-add-cart` | Удаляет элемент, если товара нет в наличии и включён запрет заказа сверх остатка (внутри обычно `data-item-add`). |
| `data-ajax-product-gallery` / `-one-photo` / `-short-description` / `-full-description` / `-properties` / `-bundle-components` | Точки подключения шаблонов. |
| `data-ajax-product-variants-select-block` | Селектор вариантов; JSON как у `data-product-variants` (в `insales-product`), внутри `<select name="variant_id" data-product-variants>`. |
| `data-ajax-product-properties` | Настройки: `maxCount` (макс. параметров, по умолчанию 100), `maxVisibleItemsCount` (скрыть лишние под класс `ajax-product-property-hidden`), `excludeHandles` (handle'ы через запятую). |
| `data-ajax-product-favorites-trigger` | Со стандартным `data-ui-favorites-trigger`; после загрузки вызвать `FavoritesProducts.update()`. |
| `data-ajax-product-compare-trigger` | Со стандартным `data-compare-trigger`; после загрузки вызвать `Compare.update()`. |
| `data-ajax-product-bundle-discount` | Скидка на комплект. |

Галерея: до 6 блоков — `gallery-image-item`, `gallery-thumb-image-item` (миниатюра), `gallery-main-iframe`, `gallery-thumb-iframe` (YouTube/Vimeo/Rutube), `gallery-main-video`, `gallery-thumb-video` (видео из «Файлы»). Вложенные: `image-link`, `image-id`, `media-link`, `media-index-href` (якорь `#video-ID`), `media-preview`, `media-content` (iframe или `<video>`).

### Адаптивные изображения

Индекс из массива `imageResizingRules` указывается в `data-ajax-product-image-resizing-rules-index` на `<source>`/`<img>` внутри `<picture>` (класс `lazyload`). Без индекса — оригинальный размер (медленно).

### CSS-классы

| Элемент | Классы |
|---|---|
| `data-ajax-product` | `ajax-product-is-loading`, `ajax-product-is-init`. |
| `data-ajax-product-form` | `ajax-product-has-many-variants`, `-has-many-old-prices`, `-has-many-sale-prices`, `ajax-product-is-bundle`, `ajax-product-gallery-video-before-image`; стандартные: `with(out)-old-price`, `with(out)-sku`, `is-available`, `not-available`, `with-sale-value`. |
| `data-ajax-product-property` | `ajax-product-property-hidden`. |
| `data-ajax-product-bundle-components` | `ajax-product-bundle-items-loading`, `-loaded`. |
| `data-ajax-product-bundle-components-item` | `ajax-product-bundle-item-is-free`. |

## ui-ajax-products

### Разметка и настройки

```liquid
<div data-ajax-products>
  <div data-ajax-products-list='{
    "collection": "my-collection",
    "limit": "20",
    "imageResizingRules": [
      {"size": "1000", "format": "webp", "resizing_type": "fit_width", "quality": "100"},
      {"size": "500", "format": "webp", "resizing_type": "fit_width", "quality": "100"},
      {"size": "100", "resizing_type": "fit_width", "quality": "100"}
    ],
    "hideVariants": "true",
    "switchImages": "false",
    "shortDescriptionWordsCount": "10"
  }'></div>

  <!-- шаблоны -->
</div>
```

| Настройка | Назначение |
|---|---|
| `collection` | handle категории. |
| `limit` | Максимум товаров. |
| `imageResizingRules` | Правила ресайза (как выше). |
| `hideVariants` | Скрывать варианты. |
| `switchImages` | Загружать первые два изображения (hover-переключение) или только первое. |
| `shortDescriptionWordsCount` | Лимит слов краткого описания. |

### Инициализация

Только публикацией события (после DOMContentLoaded компонент на него подписан):

```js
const productListNodes = Array.from(document.querySelectorAll('[data-ajax-products-list]'));
if (productListNodes && productListNodes.length) {
  productListNodes.forEach(node => {
    EventBus.publish('ui-ajax-products:load-products-list', node);
  });
}

EventBus.subscribe('init-products:ui-ajax-products', function (data) {
  FavoritesProducts.update();
  Compare.update();
  // например, инициализация слайдера
});
```

### Шаблоны (4)

| `<template>` атрибут | Назначение |
|---|---|
| `data-ajax-products-list-item-template` | Превью товара; внутри `data-ajax-products-list-item` → форма `data-ajax-products-list-item-form`. Обязателен. |
| `data-ajax-products-list-item-image-template` | Изображение: `<picture data-ajax-products-list-item-picture>` + `data-ajax-products-image-resizing-rules-index`. Обязателен. |
| `data-ajax-products-list-item-option-values-images-item-template` | Значения свойств картинками (опционален). |
| `data-ajax-products-list-item-option-values-item-text-template` | Значения свойств текстом (опционален). |

Исходники: [references/ajax-products-list-templates.md](references/ajax-products-list-templates.md).

### Атрибуты формы превью

`title`, `link`, `image`, `short-description`, `price-min`, `price-max` (связка со стандартными `data-product-card-price-from-cart` / `data-product-card-old-price`), `variants-select-block` (как выше), `add-cart`, `stickers`, `favorites-trigger`, `compare-trigger` — семантика та же, что у ui-ajax-product. Дополнительно:

`data-ajax-products-list-item-option-values` — значения свойств при наведении (виджет SP12). Настройки: `imagesOptionNames` (названия свойств-картинок через запятую, с вариантами на других языках), `showVariantsText` (`true` — всё текстом; `false` — картинки + текст). Для картинок — вложенный блок `data-ajax-products-list-item-option-values-images`.

### CSS-классы

| Элемент | Классы |
|---|---|
| `data-ajax-products-list` | `ajax-products-is-loading`, `ajax-products-is-init`. |
| `data-ajax-products-list-item-form` | `ajax-products-list-item-has-many-variants`, `-has-many-old-prices`, `-has-many-sale-prices`, `ajax-products-list-item-is-bundle`; стандартные (см. выше). |
| `data-ajax-products-list-item-option-values` | `ajax-products-list-item-option-list-values`, `-option-images-values-first`, `-option-images-values-last` (позиция свойства в «Настройки → Свойства вариантов»), `-option-list-values-colors` (у варианта не оказалось картинки). |

## События

| Событие | Направление |
|---|---|
| `ui-ajax-product:load-product` | Публикуется для инициализации одного товара (аргумент — DOM-элемент). |
| `init-product:ui-ajax-product` | После загрузки и отрисовки товара. |
| `ui-ajax-products:load-products-list` | Публикуется для инициализации списка (аргумент — DOM-элемент `data-ajax-products-list`). |
| `init-products:ui-ajax-products` | После загрузки и отрисовки всех товаров. |

## Смежные скилы

- `insales-product` — стандартная карточка товара, `data-product-variants`, атрибуты цен.
- `insales-ajax` — программный `ajaxAPI.product.get/getList` (без шаблонных компонентов).
- `insales-favorites`, `insales-compare` — триггеры и `update()`.
