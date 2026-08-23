# common.v2.js — введение и модуль «Товар» (сырая документация, часть 1)

Источник: официальная документация InSales, скопировано пользователем.

## Подключение

В шаблоны layouts.{layout,checkout2,client_account}.liquid добавить тег include_insales_scripts с параметром common-js@v2:

{% include_insales_scripts "common-js@v2" %}

Также можно подключить через settings_data.json, прописав там поле "common_js_version": "v2".
Файл settings_data.json недоступен через админ-панель — новое свойство добавляется вручную
(скачивание шаблона и установка с новыми параметрами) или через inSales-uploader.

В шаблонах четвертого поколения common-js указывается в качестве зависимости для виджетов.

## Библиотеки

- Lodash (доступен глобально)
- jQuery

## Зарезервированные переменные (глобальная область видимости)

Cart, Shop, Products, Compare, FavoritesProducts, Site, AjaxSearch, ajaxAPI, Template, EventBus.

Нельзя переопределять. При подключении Common.js к работающему сайту проверять переменные на
переопределение, особенно Cart и Site.

## Логика работы

- В разметку компонента добавляются элементы с обязательными data-атрибутами; в атрибуты через
  Liquid-переменные передаются данные из магазина. Отдельные data-атрибуты реализуют действия
  (добавление/удаление из корзины, переключение вариантов, изменение количества и т.д.).
- Common.js при загрузке страницы пробегает по элементам с data-атрибутами и инициализирует скрипты.
- Практически на каждое взаимодействие можно повесить обработчик; в callback приходит информация
  о событии (например, актуальное состояние корзины).
- Все обращения к API — после DOMContentLoaded: $(document).ready(function() {}), $(function() {}).

## Содержание документации (для навигации по будущим частям)

AJAX-товары, Товар, Корзина, Живой поиск, Сравнение, Избранное, EventBus, Модуль для работы с API
магазина, AJAX-фильтры, Форма обратной связи, Форма отзыва к товару, Форма комментария к статье,
Формы заявки и заказа в один клик, Trigger Events, Lodash шаблоны, Методы для работы с UI,
Вспомогательные методы, reCaptchaCommon API.

## Модуль «Товар»

### Пример разметки товара

<form action="{{ cart_url }}" method="post" data-product-id="{{ product.id }}">
  <div class="product__sku">
    <span data-product-card-sku='{"skuLabel": "Артикул."}'></span>
  </div>

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
    <input type="hidden" name="variant_id" value="{{product.variants.first.id}}" >
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

### Атрибуты корневого элемента

- data-product-id — обязательный для инициализации товара, принимает ID товара.
- data-product-without-cache — отключение кэширования информации о товаре.
- data-product-json='{{ product|json|escape }}' — передать данные о товаре через Liquid
  (ускоряет отображение селектора вариантов).
- data-set-config='{"decimal": {"kgm": 1}}' — перечень настроек товара.

### Атрибуты вложенных элементов

- data-product-variants — вид отображения значений свойств варианта по названию свойства.
  Виды: option-select, option-select-image, option-span, option-radio, option-preview,
  option-preview-text, option-default (= option-select).
  Пример: {"default": "option-select", "Цвет": "option-preview", "Размер": "option-span"}.
  Свой шаблон: <script type="text/template" data-template-id="custom-span">...</script>,
  затем "default": "custom-span".
- data-quantity — обязательная обёртка кнопок изменения количества и инпута quantity;
  data-min — минимальное значение.
- data-quantity-change — кнопки +/-, принимает число.
- data-item-add — добавление товара в корзину.
- data-add-cart-counter='{"step": "1"}' — компонент «добавить в корзину со счётчиком»
  (карточки товаров шаблонов 4 поколения). Вложенные элементы: data-add-cart-counter-btn,
  data-add-cart-counter-minus, data-add-cart-counter-count, data-add-cart-counter-plus.
  Событие: unchange_quantity:insales:ui_add-cart-counter (достигнут максимум в корзине).
  Скрывать/показывать кнопки по классу is-add-cart у корневого элемента.
- data-product-card-preorder — кнопка вызова формы предзаказа; при загрузке получает
  data-preorder-product-name и data-preorder-variant (обновляется при выборе варианта).
  Событие show-preorder:insales:ui_product.
- data-quick-checkout — форма заказа в один клик; можно передать селектор товара:
  data-quick-checkout="[data-product-id='{{ product.id }}']". Остальные товары в корзине
  тоже попадут в заказ.
- data-product-card-price — цена продажи варианта.
- data-product-card-price-from-cart — цена с учётом типов цен.
- data-product-card-old-price — старая цена варианта.
- data-product-card-sku='{"skuLabel": "..."}' — артикул варианта.
- data-product-card-available='{"availableText": "...", "notAvailableText": "..."}' — наличие.
- name="comment" — комментарий к позиции заказа; включается в админ-панели
  «Настройки» > «Оформление заказа».

### Селектор модификаций

Привязка шаблона к опции через Products.setConfig({ options: { 'Цвет': 'option-image', ... } }).

Передача изображений: ссылки формируются как <значение свойства>.png | file_url; создать объект
fileUrl (для collection через collections[collection_handle].options, для product через
product.options), затем Products.setConfig({ fileUrl: ... }).

Шаблоны: option-select, option-select-image, option-span, option-radio, option-preview,
option-preview-text — полные исходники в скиле references/variant-templates.md.

### Методы класса Products

- Products.get(id) -> Deferred — объект с информацией о товаре.
  Products.get(123456).done(fn).fail(fn)
- Products.getList(idList, options) -> Deferred — список товаров;
  options: { no_cache: true } — не кешировать в local storage.

### События — НЕ ДОСТАВЛЕНЫ (ждут следующую часть документации)
