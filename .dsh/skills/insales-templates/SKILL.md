---
name: insales-templates
description: Lodash-шаблоны и UI-методы common.v2.js InSales — класс Template (load/render), data-template-id, InSalesUI.initAjaxInstance и bindUpdateCart, динамическая корзина через EventBus + Template.render
whenToUse: При динамическом рендере компонентов InSales lodash-шаблонами — виджет корзины без перезагрузки, перевёрстка отрендеренного common.v2.js блока, загрузка шаблонов из JS, реинициализация формы корзины после перерисовки
---

# Lodash шаблоны и UI (common.v2.js, InSales)

## Класс Template

Хранение и получение шаблонов на шаблонизаторе Lodash. `Template` — зарезервированная глобальная переменная, не переопределять.

### Разметка шаблона

```html
<script type="text/template" data-template-id="option-select">
  <div class="<%= classes.option %> is-select">
    <label class="<%= classes.label %>"><%= title %></label>
    <select class="<%= classes.values %>" data-option-bind="<%= option.id %>">
      <% _.forEach(values, function (value){ %>
        <option <%= value.controls %> <%= value.state %>><%= value.title %></option>
      <% }) %>
    </select>
  </div>
</script>
```

Интерполяция `<%= %>`, логика `<% %>` — стандартный Lodash.

### Методы

```js
/**
 * @param {string} template_body - вёрстка шаблона
 * @param {string} template_id  - название шаблона
 */
Template.load('<button class="button button--click_me"><%= title %></button>', 'test-button');

/**
 * @param {Object} templateData - данные для шаблонизатора
 * @param {string} template_id  - название шаблона
 * @returns {string} HTML-строка
 */
$(targetNode).html(Template.render({ title: 'Click me!' }, 'test-button'));
```

## InSalesUI

### initAjaxInstance

Инициализация формы корзины в переданном jQuery-узле — обязательна после каждой перерисовки корзины шаблоном, иначе data-атрибуты позиции (`data-quantity`, `data-item-delete` и т.д.) перестают работать:

```js
/**
 * @param {jquery} jquery-объект
 */
InSalesUI.initAjaxInstance($(".js-dynamic_basket"));
```

### bindUpdateCart

Обновление слушателей quantity в форме корзины.

## Динамическая корзина (канонический паттерн)

Подписка на обновление корзины → рендер шаблоном → реинициализация:

```js
EventBus.subscribe("update_items:insales:cart", function(cart) {
  $(".js-dynamic_basket").html(Template.render(cart, "dynamic_basket"));
  InSalesUI.initAjaxInstance($(".js-dynamic_basket"));
});
```

В шаблоне доступны данные корзины: `order_lines[]` (`id`, `product_id`, `title`, `quantity`, `sale_price`, `first_image.medium_url`), `total_price`; форматирование денег — `Shop.money.format(...)` (скил `insales-helpers`).

Полный исходник шаблона `dynamic_basket` с формой, счётчиками количества и удалением позиций: [references/dynamic-basket.md](references/dynamic-basket.md).

## Смежные скилы

- `insales-cart` — атрибуты формы корзины и класс `Cart`.
- `insales-eventbus` — события, на которые опирается паттерн.
- `insales-helpers` — `Shop.money.format` и прочие утилиты.
