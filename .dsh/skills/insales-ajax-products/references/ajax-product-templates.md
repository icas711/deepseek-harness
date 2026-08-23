# ui-ajax-product: исходники шаблонов

Каждый шаблон — отдельный `<template>` внутри блока `data-ajax-product`.

## Карточка — data-ajax-product-template

Внутри обязательна форма `data-ajax-product-form`; атрибуты формы (title, link, stickers, gallery, variants-select-block и т.д.) — в SKILL.md.

## Галерея — data-ajax-product-gallery-template

До 6 блоков: основное изображение, миниатюра изображения, iframe-видео, миниатюра iframe-видео, видео из «Файлов», миниатюра видео.

```html
<template data-ajax-product-gallery-template>
    <!-- Изображение -->
    <div data-ajax-product-gallery-image-item>
      <a data-ajax-product-image-link>
        <div>
          <picture>
            <source data-ajax-product-image-resizing-rules-index="0" media="(min-width:768px)" type="image/webp" class="lazyload">
            <source media="(max-width:767px)" data-ajax-product-image-resizing-rules-index="1" type="image/webp" class="lazyload">
            <img data-ajax-product-image-resizing-rules-index="2" class="lazyload" />
          </picture>
        </div>
      </a>
    </div>

    <!-- Миниатюра изображения -->
    <div data-ajax-product-gallery-thumb-image-item>
        <div>
          <picture>
            <source data-ajax-product-image-resizing-rules-index="3" type="image/webp" class="lazyload">
            <img data-ajax-product-image-resizing-rules-index="4" class="lazyload" />
          </picture>
        </div>
    </div>

    <!-- iframe-видео (YouTube/Vimeo/Rutube) -->
    <div data-ajax-product-gallery-main-iframe>
      <a data-ajax-product-gallery-media-index-href>
        <div class="control play"><span class="center"></span></div>
        <div class="img-ratio__inner">
          <img data-ajax-product-gallery-media-preview />
        </div>
        <div data-ajax-product-gallery-media-content></div>
      </a>
    </div>

    <!-- Миниатюра iframe-видео -->
    <div data-ajax-product-gallery-thumb-iframe>
        <div class="control play"><span class="center"></span></div>
        <div class="img-ratio__inner">
          <img data-ajax-product-gallery-media-preview />
        </div>
    </div>

    <!-- Видео из «Сайт → Файлы» -->
    <div data-ajax-product-gallery-main-video>
      <a data-ajax-product-gallery-media-link>
        <div data-ajax-product-gallery-media-content></div>
      </a>
    </div>

    <!-- Миниатюра видео из «Файлов» — блок data-ajax-product-gallery-thumb-video,
         вложенные элементы те же, что у main-video -->
</template>
```

Элементы видео: `media-link` (href), `media-index-href` (якорь `#video-<ID>` для связи с миниатюрой), `media-preview` (src превью), `media-content` (innerHTML `<iframe>` для ссылок; замена на `<video><source>` для файлов).

## Единственное фото — data-ajax-product-one-photo-template

```html
<template data-ajax-product-one-photo-template>
    <div data-ajax-product-one-photo-item>
        <a data-ajax-product-image-link>
            <picture>
              <source data-ajax-product-image-resizing-rules-index="0" media="(min-width:768px)" type="image/webp" class="lazyload">
              <source media="(max-width:767px)" data-ajax-product-image-resizing-rules-index="1" type="image/webp" class="lazyload">
              <img data-ajax-product-image-resizing-rules-index="2" class="lazyload" />
            </picture>
        </a>
    </div>
</template>
```

## Краткое / полное описание

```html
<template data-ajax-product-short-description-template>
    <div data-ajax-product-short-description-item-text></div>
</template>

<template data-ajax-product-full-description-template>
    <div data-ajax-product-full-description-item-text></div>
</template>
```

Обрамление (кнопки «Свернуть/Развернуть» как в виджете SP16) — любая вложенность вокруг `...-item-text`.

## Параметры — data-ajax-product-properties-template

```html
<template data-ajax-product-properties-template>
    <div class="content-properties">
        <div class="properties-items">
            <div class="property" data-ajax-product-property>
                <div class="property-name" data-ajax-product-property-title></div>
                <div class="delimiter"></div>
                <div class="property-content" data-ajax-product-property-characteristic-title></div>
            </div>
            <span data-ajax-product-properties-show-more-btn class="button-link more-items js-more-prop">{{ messages.more_prop }}</span>
            <span data-ajax-product-properties-hide-btn class="button-link hide-items js-hide-prop">{{ messages.more_prop }}</span>
        </div>
    </div>
</template>
```

Кнопки опциональны; не выводятся, если параметров меньше `maxVisibleItemsCount`.

## Компонент комплекта — data-ajax-product-bundle-components-item-template

```html
<template data-ajax-product-bundle-components-item-template>
    <div data-ajax-product-bundle-components-item>
      <div class="bundle-item__photo">
        <div class="img-ratio img-ratio_cover product__photo">
          <div class="img-ratio__inner">
            <a data-ajax-product-bundle-components-item-link target="_blank">
              <img data-ajax-product-bundle-components-item-image>
            </a>
          </div>
        </div>
      </div>
      <div class="bundle-item__info">
        <div class="bundle-item__name">
          <a data-ajax-product-bundle-components-item-title data-ajax-product-bundle-components-item-link target="_blank"></a>
        </div>
        <div data-ajax-product-bundle-components-item-options class="bundle-item__property-list"></div>
        <div class="bundle-item__price">
          <div class="bundle-item__free">
            <span data-ajax-product-bundle-components-item-quantity></span> x <span>{{ widget_messages.product_bundle_gift_text }}</span>
          </div>
          <div class="bundle-item__not_free">
            <span data-ajax-product-bundle-components-item-quantity></span> x <span data-ajax-product-bundle-components-item-variant-price></span>
          </div>
        </div>
      </div>
    </div>
</template>
```

Атрибуты компонента: `-title`, `-link`, `-image` (src), `-quantity`, `-product-price`, `-variant-price` (нулевая цена → класс `ajax-product-bundle-item-is-free`), `-options` (точка подключения шаблона свойств).

## Свойства компонента комплекта — data-ajax-product-bundle-components-item-options-template

```html
<template data-ajax-product-bundle-components-item-options-template>
    <div data-ajax-product-bundle-components-item-options-item class="bundle-item__property-item">
        <span data-ajax-product-bundle-components-item-options-item-name-title></span>: <span data-ajax-product-bundle-components-item-options-item-value-title></span>
    </div>
</template>
```
