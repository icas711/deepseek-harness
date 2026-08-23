# AJAX-фильтры: исходники шаблонов

Шесть `<template>`-блоков внутри формы `data-ajax-filter`. Каждый — отдельный элемент формы, не вложенный в другие.

## Фильтр по цене — data-ajax-filter-template-price

```html
<template data-ajax-filter-template-price>
  <div class="filter-item filter-item_price">
    <div class="filter-item__head">
      <span class="filter-item__name">{{ messages.filter_price_title }}</span>
    </div>
    <div class="filter-item__content">
      <div data-ajax-filter-range class="filter-range">
        <div class="filter-range__values">
          <div class="filter-range__values-item">
            <span class="filter-range__values-label">От</span>
            <input
              data-ajax-filter-range-field-min
              type="text"
              name="price_min"
              value="{{ price_min }}"
              {% unless price_min %} disabled {% endunless %}
            />
          </div>
          <div class="filter-range__values-item">
            <span class="filter-range__values-label">До</span>
            <input
              data-ajax-filter-range-field-max
              type="text"
              name="price_max"
              value="{{ price_max }}"
              {% unless price_max %} disabled {% endunless %}
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
```

## Элемент фильтра (группа) — data-ajax-filter-template-item

```html
<template data-ajax-filter-template-item>
  <div class="filter-item" data-ajax-filter-item>
    <div class="filter-item__head">
      <span class="filter-item__name" data-ajax-filter-item-title></span>
    </div>
    <div class="filter-item__content">
      <div class="filter-item__list" data-ajax-filter-item-content></div>
    </div>
  </div>
</template>
```

## Значения параметров и свойств — data-ajax-filter-template-usual

```html
<template data-ajax-filter-template-usual>
  <div class="filter-item__list-item">
    <label class="filter-option _checkbox">
      <input autocomplete="off" class="filter-option__field" type="checkbox" />
      <span class="filter-option__content">
        <span class="filter-option__label" data-ajax-filter-option-label></span>
      </span>
    </label>
  </div>
</template>
```

## Значения свойств картинками — data-ajax-filter-template-color

```html
<template data-ajax-filter-template-color>
  <div class="filter-item__list-item ">
    <label class="filter-option _checkbox">
      <input autocomplete="off" class="filter-option__field" type="checkbox" name="options[][]" />
      <span class="filter-option__content">
        <span class="filter-option__label" data-ajax-filter-option-image></span>
      </span>
    </label>
  </div>
</template>
```

## Числовой параметр — data-ajax-filter-template-numeric

```html
<template data-ajax-filter-template-numeric>
  <div data-ajax-filter-range class="filter-range">
    <div class="filter-range__values">
      <div class="filter-range__values-item">
        <span class="filter-range__values-label">От</span>
        <input data-ajax-filter-range-field-min type="text" />
      </div>
      <div class="filter-range__values-item">
        <span class="filter-range__values-label">До</span>
        <input data-ajax-filter-range-field-max type="text" />
      </div>
    </div>
  </div>
</template>
```

## Прелоадер — data-ajax-filter-items-template-preloader

```html
<template data-ajax-filter-items-template-preloader>
  <div data-ajax-filter-items-preloader></div>
</template>
```
