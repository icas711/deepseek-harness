# common.v2.js — AJAX-товары ui-ajax-product / ui-ajax-products (сырая документация, часть 6)

Источник: официальная документация InSales, скопировано пользователем. Полный текст сохранён
в скиле insales-ajax-products и его references.

## ui-ajax-product

Блок data-ajax-product с настройками: productId, productData (массив строк данных товара),
initOnLoadPage (bool), imageResizingRules (массив {size, format, resizing_type, quality}),
videoBeforeImage (bool), videoLinksDetails (рекомендуется true).

Инициализация: автоматическая при initOnLoadPage=true (DOMContentLoaded) либо публикацией
события ui-ajax-product:load-product с DOM-элементом (настройки записать в dataset.ajaxProduct).
Событие завершения: init-product:ui-ajax-product.

Шаблоны (каждый отдельный внутри data-ajax-product): data-ajax-product-template (карточка,
внутри обязательна форма data-ajax-product-form), gallery-template, one-photo-template,
short-description-template, full-description-template, properties-template,
bundle-components-item-template, bundle-components-item-options-template.

Вложенные атрибуты формы: title, link, stickers, sizes-table-btn (значение — названия свойств
через запятую), add-cart, gallery, one-photo, variants-select-block (JSON как data-product-variants,
внутри select data-product-variants), short-description, full-description, properties (настройки
maxCount, maxVisibleItemsCount, excludeHandles), unit, favorites-trigger (+ data-ui-favorites-trigger,
после загрузки вызвать FavoritesProducts.update()), compare-trigger (+ data-compare-trigger,
Compare.update()), bundle-discount, bundle-components.

Галерея — до 6 блоков: gallery-image-item, gallery-thumb-image-item, gallery-main-iframe,
gallery-thumb-iframe, gallery-main-video, gallery-thumb-video; вложенные media-link,
media-index-href (#video-ID), media-preview, media-content. Изображения через
data-ajax-product-image-resizing-rules-index (индекс из imageResizingRules) в <picture>;
без индекса — оригинальный размер.

productData по умолчанию: URL, название, наличие, единицы, мин./макс. цена. Дополнительно:
variants, short_description, description, price_kinds, first_image, images, properties,
characteristics, option_names, bundle_info, video_links.

CSS-классы: ajax-product-is-loading / -is-init (корень), ajax-product-has-many-variants /
-has-many-old-prices / -has-many-sale-prices / -is-bundle / ajax-product-gallery-video-before-image
(форма) + стандартные with(out)-old-price, with(out)-sku, is-available, not-available,
with-sale-value; ajax-product-property-hidden; ajax-product-bundle-items-loading / -loaded;
ajax-product-bundle-item-is-free.

## ui-ajax-products

Блок data-ajax-products, внутри data-ajax-products-list с настройками: collection (handle),
limit, imageResizingRules, hideVariants, switchImages (первые два изображения?), 
shortDescriptionWordsCount. Шаблоны внутри data-ajax-products.

Инициализация только публикацией ui-ajax-products:load-products-list с DOM-элементом.
Событие завершения: init-products:ui-ajax-products.

Шаблоны (4): data-ajax-products-list-item-template (внутри data-ajax-products-list-item и
форма data-ajax-products-list-item-form), image-template (picture +
data-ajax-products-image-resizing-rules-index), option-values-images-item-template,
option-values-item-text-template (последние два опциональны).

Атрибуты формы превью: title, link, image, short-description, price-min, price-max
(связка с data-product-card-price-from-cart / old-price), variants-select-block, add-cart,
option-values (настройки imagesOptionNames, showVariantsText; вложенный блок
option-values-images), stickers, favorites-trigger, compare-trigger (аналогично update()).

CSS-классы: ajax-products-is-loading / -is-init; ajax-products-list-item-has-many-variants /
-has-many-old-prices / -has-many-sale-prices / -is-bundle + стандартные; option-list-values,
option-images-values-first / -last, option-list-values-colors.

Примеры в виджетах SP9, SP12, SP16.
