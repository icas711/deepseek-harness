# Атрибуты товара и fileUrl: расширенные примеры

## Счётчик «добавить в корзину» (шаблоны 4 поколения)

```liquid
<div class="add-cart-counter" data-add-cart-counter='{"step": "1"}'>
  <button type="button" class="add-cart-counter__btn" data-add-cart-counter-btn>
    Add to cart
  </button>
  <div class="add-cart-counter__controls">
    <button data-add-cart-counter-minus class="add-cart-counter__controls-btn" type="button">-</button>
    <a href="{{ cart_url }}" class="add-cart-counter__detail">
      <span class="add-cart-counter__detail-text">{{ messages.btn_buy_active_text }} <span data-add-cart-counter-count></span> {{ product.unit }}</span>
    </a>
    <button data-add-cart-counter-plus class="add-cart-counter__controls-btn" type="button">+</button>
  </div>
</div>
```

Скрывать/показывать кнопки по наличию класса `is-add-cart` у корневого элемента. Событие максимума:

```js
EventBus.subscribe('unchange_quantity:insales:ui_add-cart-counter', data => {
  console.log(data);
});
```

## Предзаказ

```liquid
<button data-product-card-preorder type="button">{{ messages.pre_order }}</button>
```

При загрузке кнопка получает `data-preorder-product-name` и `data-preorder-variant` (обновляется при выборе варианта). Название товара и варианта для формы:

```js
EventBus.subscribe('show-preorder:insales:ui_product', data => {
  // data — название товара и выбранного варианта
});
```

## Передача изображений для опций (fileUrl)

Ссылка на файл формируется как `<значение свойства с _ вместо пробелов>.png` через фильтр `file_url`. Ключи объекта — значения свойства в нижнем регистре.

Из коллекции:

```liquid
<script>
  if (!fileUrl) { var fileUrl = {} }
  {% assign option_title = 'Цвет' %}
  {% assign collection_handle = 'all' %}
  {% assign image_format = '.png' %}
  {% for option_name in collections[collection_handle].options %}
    {% if option_name.title == option_title %}
      {% for option_value in option_name.values %}
        {% capture fileName %}{{ option_value.title | replace: ' ', '_' }}{{ image_format }}{% endcapture %}
        {% assign fileURL = fileName | file_url %}
        {% if fileURL %}
          fileUrl['{{ option_value.title | downcase }}'] = '{{ fileURL }}';
        {% endif %}
      {% endfor %}
    {% endif %}
  {% endfor %}
</script>
```

Из товара:

```liquid
<script>
  if (!fileUrl) { var fileUrl = {} }
  {% assign option_title = 'цвет' %}
  {% assign image_format = '.png' %}
  {% for option in product.options %}
    {% assign option-title = option.title | downcase %}
    {% if option-title == option_title %}
      {% for value in option.values %}
        {% capture fileName %}{{ value.title | replace: ' ', '_' }}{{ image_format }}{% endcapture %}
        {% assign fileURL = fileName | downcase | file_url %}
        {% if fileURL %}
          fileUrl['{{ value.title | downcase }}'] = encodeURI('{{ fileURL }}');
        {% endif %}
      {% endfor %}
    {% endif %}
  {% endfor %}
</script>

<script>
  Products.setConfig({
    fileUrl: (typeof fileUrl == 'undefined') ? {} : fileUrl
  });
</script>
```
