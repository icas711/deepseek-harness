---
name: insales-product
description: Модуль «Товар» JS-библиотеки common.v2.js платформы InSales — карточка товара, data-атрибуты, селектор модификаций, класс Products
whenToUse: При создании или редактировании шаблонов карточки товара InSales, селектора вариантов (модификаций), кнопок добавления в корзину, предзаказа, покупки в один клик, а также при работе с классом Products (Products.get / Products.getList)
---

# Модуль «Товар» (common.v2.js, InSales)

## Предусловия

Библиотека подключается тегом `{% include_insales_scripts "common-js@v2" %}` в `layouts.{layout,checkout2,client_account}.liquid`, либо полем `"common_js_version": "v2"` в `settings_data.json` (файл правится вручную или через inSales-uploader). В шаблонах 4 поколения common-js — зависимость виджетов.

Зарезервированные глобальные переменные (не переопределять, особенно `Cart` и `Site`): `Cart`, `Shop`, `Products`, `Compare`, `FavoritesProducts`, `Site`, `AjaxSearch`, `ajaxAPI`, `Template`, `EventBus`. Глобально доступны Lodash (`_`) и jQuery (`$`).

Все обращения к API — только после `DOMContentLoaded`: `$(document).ready(function() {})` или `$(function() {})`.

## Логика работы

1. В разметку компонента добавляются элементы с data-атрибутами; данные из магазина передаются в атрибуты через Liquid-переменные. Отдельные data-атрибуты реализуют действия (добавление/удаление из корзины, переключение вариантов, изменение количества).
2. Common.js при загрузке страницы обходит элементы с data-атрибутами и инициализирует компоненты.
3. На каждое взаимодействие вешается обработчик; в callback приходит состояние (например, актуальная корзина).

## Канонический пример разметки

```liquid
<form action="{{ cart_url }}" method="post" data-product-id="{{ product.id }}">
  <span data-product-card-sku='{"skuLabel": "Артикул."}'></span>
  <span data-product-card-available='{"availableText": "Товар в наличии", "notAvailableText": "Нет в наличии"}'></span>
  <div data-product-card-old-price></div>
  <div data-product-card-price></div>

  {% if product.show_variants? %}
    <select name="variant_id" data-product-variants='{"default": "option-radio"}'>
      {% for variant in product.variants %}
        <option value="{{ variant.id }}">{{ variant.title | escape }}</option>
      {% endfor %}
    </select>
  {% else %}
    <input type="hidden" name="variant_id" value="{{ product.variants.first.id }}">
  {% endif %}

  <input type="text" name="comment" value="">

  <div data-quantity data-min="1">
    <input type="text" name="quantity" value="1" />
    <span data-quantity-change="-1">-</span>
    <span data-quantity-change="1">+</span>
  </div>

  <button type="submit" data-item-add>Добавить в корзину</button>

  {% if account.quick_checkout.enabled %}
    <button data-quick-checkout="[data-product-id='{{ product.id }}']">Купить в 1 клик</button>
  {% endif %}
</form>
```

## Формы заявки и заказа в один клик

Обе формы аналогичны, отдаются сервером вместе с HTML страницы и реализованы как модальные окна — из разметки нужна только кнопка активации.

```liquid
<!-- Заказ в один клик: значение — селектор формы товара -->
<button data-quick-checkout='[data-product-id="12345678"]'>Купить в один клик</button>

<!-- Форма заявки: дополнительно data-quick-checkout-modal-handle="service" -->
<button
  data-quick-checkout='[data-product-id="12345678"]'
  data-quick-checkout-modal-handle="service"
>
  Оформить заявку
</button>

<!-- Без привязки к товару: fake_order (+ собственное имя заглушки) -->
<button
  data-quick-checkout='fake_order'
  data-quick-checkout-fake-order-name="имя товара"
>
  Купить в один клик
</button>
<button
  data-quick-checkout='fake_order'
  data-quick-checkout-modal-handle="service"
  data-quick-checkout-fake-order-name="имя товара"
>
  Оформить заявку
</button>
```

`fake_order` создаёт заказ с заглушкой вместо наименования товара; `data-quick-checkout-fake-order-name` задаёт её текст.

## Атрибуты

Корневой элемент (форма товара):

| Атрибут | Назначение |
|---|---|
| `data-product-id="{{ product.id }}"` | Обязателен для инициализации товара. |
| `data-product-without-cache` | Отключить кэширование информации о товаре. |
| `data-product-json="{{ product\|json\|escape }}"` | Передать данные товара через Liquid — ускоряет отрисовку селектора вариантов. |
| `data-set-config='{"decimal": {"kgm": 1}}'` | Настройки товара. |

Вложенные элементы:

| Атрибут | Назначение |
|---|---|
| `data-product-variants` | Вид отображения значений свойств варианта. Значение — JSON: `default` + имя свойства → шаблон. Виды: `option-select`, `option-select-image`, `option-span`, `option-radio`, `option-preview`, `option-preview-text`, `option-default` (= select). Пример: `{"default": "option-select", "Цвет": "option-preview", "Размер": "option-span"}`. |
| `data-quantity` (+ `data-min`) | Обёртка инпута количества и кнопок +/-; `data-min` — минимум. |
| `data-quantity-change="-1\|1"` | Кнопки изменения количества. |
| `data-item-add` | Добавление товара в корзину. |
| `data-add-cart-counter='{"step": "1"}'` | Компонент «кнопка + счётчик» для карточек шаблонов 4 поколения. Вложенные: `data-add-cart-counter-btn`, `data-add-cart-counter-minus`, `data-add-cart-counter-count`, `data-add-cart-counter-plus`. Переключать вид по классу `is-add-cart` корневого элемента. Событие максимума: `unchange_quantity:insales:ui_add-cart-counter`. |
| `data-product-card-preorder` | Кнопка формы предзаказа; получает `data-preorder-product-name` и `data-preorder-variant` (обновляется при выборе варианта). Событие: `show-preorder:insales:ui_product`. |
| `data-quick-checkout` | Заказ в один клик. Значение — селектор товара: `"[data-product-id='{{ product.id }}']"`. Прочие товары в корзине тоже попадут в заказ. |
| `data-product-card-price` | Цена продажи варианта. |
| `data-product-card-price-from-cart` | Цена с учётом типов цен. |
| `data-product-card-old-price` | Старая цена варианта. |
| `data-product-card-sku='{"skuLabel": "..."}'` | Артикул варианта. |
| `data-product-card-available='{"availableText": "...", "notAvailableText": "..."}'` | Наличие варианта. |
| `name="comment"` | Комментарий к позиции заказа (включается в админ-панели «Настройки» → «Оформление заказа»). |

## Селектор модификаций

Вид по имени опции через `Products.setConfig`:

```js
Products.setConfig({
  options: {
    'Цвет': 'option-image',
    'Размер': 'option-radio',
    'Материал': 'option-select',
    'Жесткий диск': 'option-span'
  }
});
```

Свой шаблон: `<script type="text/template" data-template-id="custom-span">...</script>` и `"default": "custom-span"` в `data-product-variants`. Полные исходники встроенных шаблонов — [references/variant-templates.md](references/variant-templates.md).

Изображения для опций: сформировать Liquid-ом объект `fileUrl` (ключ — значение свойства в нижнем регистре, ссылка — `<значение>.png | file_url`, пробелы заменить на `_`; источники — `collections[collection_handle].options` или `product.options`) и передать `Products.setConfig({ fileUrl })`. Подробный пример — [references/product-attributes.md](references/product-attributes.md).

## Класс Products

Кэширование: полученные товары кэшируются в local storage в рамках одной сессии (после перезагрузки страницы — снова запрос к серверу). Обход — `{ no_cache: true }` вторым аргументом. В одном запросе не более 700 товаров; более длинный массив обрезается перед отправкой.

```js
// Информация о товаре; Deferred
Products.get(123456)
  .done(function (onDone) { console.log('onDone', onDone) })
  .fail(function (onFail) { console.log('onFail', onFail) });

// Список товаров; no_cache — не кешировать в local storage
Products.getList([123456, 123455, 1234454, 123458], { no_cache: true })
  .done(function (onDone) { /* ... */ })
  .fail(function (onFail) { /* ... */ });

// Экземпляр ProductInstance из jQuery-элемента; Deferred
Products.getInstance($('.product-cart-control'))
  .done(function (onDone) { /* ... */ })
  .fail(function (onFail) { /* ... */ });

// Инициализация формы товара; Deferred
Products.initInstance($('.product-cart-control'))
  .done(function (onDone) { /* ... */ })
  .fail(function (onFail) { /* ... */ });

// Массив ID просмотренных товаров; Deferred
Products.getRecentlyViewed()
  .done(function (onDone) { /* ... */ })
  .fail(function (onFail) { /* ... */ });
```

### setConfig

**Вызывать в глобальной области видимости** — вызов внутри `$(document).ready(...)` даёт непредсказуемый результат.

| Свойство | По умолчанию | Назначение |
|---|---|---|
| `options` | `{ 'default': 'option-default' }` | Шаблоны вывода свойств варианта (имя опции → ID шаблона). |
| `fileUrl` | `{}` | Картинки опций из раздела «Файлы». |
| `decimal` | `{}` | Знаков после запятой для единиц измерения. |
| `filtered` | `true` | Недоступные опции не выводятся в шаблон. |
| `disableHideItem` | `false` | Показывать отсутствующие варианты, даже если скрыты в админ-панели. |
| `selectUnavailable` | `true` | Разрешить выбирать недоступный вариант (актуально при `filtered: false`). |
| `allowUnavailable` | `false` | Разрешить выбирать первым недоступный вариант. |
| `showVariants` | `true` | `false` — рендер вариантов не производится. |
| `initOption` | `true` | Отмечать активные свойства при инициализации. |
| `useMax` | `false` | `true` — в quantity нельзя указать больше, чем на складе. |

```js
Products.setConfig({
  showVariants: true,
  hideSelect: true,
  initOption: true,
  fileUrl: (typeof fileUrl == 'undefined') ? {} : fileUrl,
  filtered: true,
  selectUnavailable: true
});
```

## События

Подписка через `EventBus.subscribe('<событие>', function (data) { ... })`.

| Событие | Описание |
|---|---|
| `init_instance:insales:product` | После инициализации обёрток `[data-product-id]` со всеми дочерними элементами. |
| `before:insales:product` | Перед любым взаимодействием с компонентом товара. |
| `always:insales:product` | После любого взаимодействия. |
| `change_quantity:insales:product` | Обновление количества в инпуте quantity. |
| `unchange_quantity:insales:product` | Введено количество больше доступного. |
| `overload:quantity:insales:product` | Кнопками +/- достигнут максимум quantity (при `useMax`). |
| `max:quantity:insales:product` | В инпуте установлено максимальное количество, включая момент загрузки (при `useMax`). |
| `change_variant:insales:product` | При выборе варианта товара. |
| `update_variant:insales:product` | Обновление варианта товара. |

```js
EventBus.subscribe('change_quantity:insales:product', function (data) {
  console.log('Изменено количество товара в счётчике', data);
});
```

## Смежные скилы

- Корзина — скил `insales-cart` (разметка формы корзины, класс `Cart`, события корзины и позиций). AJAX API магазина, EventBus — отдельные скилы по мере создания.
