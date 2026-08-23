# ui-ajax-products: исходники шаблонов

## Превью товара — data-ajax-products-list-item-template

```html
<template data-ajax-products-list-item-template>
    <div data-ajax-products-list-item>
        <form action="{{ cart_url }}" method="post" data-ajax-products-list-item-form>
            <!-- код превью: title, link, image, price-min/max, option-values, stickers и т.д. -->
        </form>
    </div>
</template>
```

Пример связки цен со стандартными атрибутами карточки товара:

```html
<div class="product-preview__price">
  <span class="product-preview__price-label">{{ messages.from }}</span>
  <span class="product-preview__price-min" data-ajax-products-list-item-price-min></span>
  <span class="product-preview__price-cur" data-product-card-price-from-cart></span>
  <span class="product-preview__price-old" data-product-card-old-price></span>
</div>
```

Селектор вариантов:

```html
<div data-ajax-products-list-item-variants-select-block='{
  "default": "option-radio",
  "Цвет": "{{ widget_settings.display-property-color }}"
}'>
  <select name="variant_id" data-product-variants></select>
</div>
```

Значения свойств при наведении (виджет SP12):

```html
<div data-ajax-products-list-item-option-values='{
  "imagesOptionNames": "цвет,color,расцветка,цвет товара",
  "showVariantsText": "{{ widget_settings.show-variants-text }}"
}'>
  <div class="option-list-values with-images">
    <div class="option-list-images" data-ajax-products-list-item-option-values-images></div>
  </div>
</div>
```

Кнопки избранного и сравнения (после отрисовки вызвать `FavoritesProducts.update()` / `Compare.update()`):

```html
{% if settings.favorite_enabled %}
<span class="button button_size-s favorites_btn" data-ui-favorites-trigger data-ajax-products-list-item-favorites-trigger>
  <span class="btn-icon icon-favorites-o"></span>
  <span class="btn-icon icon-favorites-f"></span>
</span>
{% endif %}

{% if settings.compare_enabled == null or settings.compare_enabled %}
<div class="product__compare">
  <span data-compare-trigger data-ajax-products-list-item-compare-trigger>
    <span class="product__user-btn-icon icon-compare"></span>
    <span
      data-compare-trigger-added-text="{{ messages.btn_compare_text_active }}"
      data-compare-trigger-not-added-text="{{ messages.btn_compare_text }}"
    >{{ messages.btn_compare_text }}</span>
  </span>
</div>
{% endif %}
```

## Изображение — data-ajax-products-list-item-image-template

```html
<template data-ajax-products-list-item-image-template>
    <picture data-ajax-products-list-item-picture>
      <source media="(min-width:481px)" data-ajax-products-image-resizing-rules-index="0" type="image/webp" class="lazyload">
      <source media="(max-width:480px)" data-ajax-products-image-resizing-rules-index="1" type="image/webp" class="lazyload">
      <img data-ajax-products-image-resizing-rules-index="2" class="lazyload">
    </picture>
</template>
```

Без `data-ajax-products-image-resizing-rules-index` — оригинальный размер изображения.

## Значения свойств картинками — data-ajax-products-list-item-option-values-images-item-template

```html
<template data-ajax-products-list-item-option-values-images-item-template>
    <div class="option-list-image" data-ajax-products-list-item-option-values-images-item>
      <div class="img-ratio img-fit">
        <div class="img-ratio__inner">
          <img width="48" data-ajax-products-list-item-option-values-images-item-img>
        </div>
      </div>
    </div>
</template>
```

## Значения свойств текстом — data-ajax-products-list-item-option-values-item-text-template

```html
<template data-ajax-products-list-item-option-values-item-text-template>
    <div
      class="option-list-value"
      data-ajax-products-list-item-option-values-item-text
      data-ajax-products-list-item-option-values-item-id
    ></div>
</template>
```
