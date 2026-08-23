# common.v2.js — конец модуля «Товар» + модуль «Корзина» (сырая документация, часть 2)

Источник: официальная документация InSales, скопировано пользователем.

## Товар: кэширование и лимиты

- Полученные товары кэшируются в local storage в рамках одной сессии (перезагрузка страницы
  сбрасывает кэш). Обход: второй аргумент { no_cache: true }.
- Не более 700 товаров в одном запросе; при превышении массив обрезается перед отправкой.

## Products.setConfig — параметры

| Property | Default | Назначение |
|---|---|---|
| options | { 'default': 'option-default' } | шаблоны вывода свойств варианта |
| fileUrl | {} | картинки из раздела «Файлы» |
| decimal | {} | количество символов после запятой для единиц измерения |
| filtered | true | недоступные опции не выводятся в шаблон |
| disableHideItem | false | показывать отсутствующие варианты, даже если скрыты в админке |
| selectUnavailable | true | разрешить выбирать недоступный вариант (актуально при filtered: false) |
| allowUnavailable | false | разрешить выбирать первым недоступный вариант |
| showVariants | true | false — рендер вариантов не производится |
| initOption | true | отмечать активные свойства при инициализации |
| useMax | false | true — в quantity нельзя указать больше, чем на складе |

Важно: вызов setConfig оставлять в глобальной области видимости; внутри
$(document).ready результат непредсказуем.

Пример:

Products.setConfig({
  showVariants: true,
  hideSelect: true,
  initOption: true,
  fileUrl: (typeof fileUrl == 'undefined') ? {} : fileUrl,
  filtered: true,
  selectUnavailable: true
})

## Прочие методы Products

- Products.getInstance($node) -> Deferred — экземпляр ProductInstance из jQuery DOM element.
- Products.initInstance($node) -> Deferred — инициализация формы товара.
- Products.getRecentlyViewed() -> Deferred — массив ID просмотренных товаров.

## События товара

| Событие | Описание |
|---|---|
| init_instance:insales:product | после инициализации обёрток [data-product-id] с дочерними элементами |
| before:insales:product | перед любым взаимодействием с компонентом товара |
| always:insales:product | после любого взаимодействия |
| change_quantity:insales:product | обновление количества в инпуте quantity |
| unchange_quantity:insales:product | введено количество больше доступного |
| overload:quantity:insales:product | +/- достигли максимума quantity (при useMax) |
| max:quantity:insales:product | в инпуте установлено макс. кол-во, даже при загрузке (при useMax) |
| change_variant:insales:product | при выборе варианта товара |
| update_variant:insales:product | обновление варианта товара |

Подписка: EventBus.subscribe('change_quantity:insales:product', function (data) {...});

## Корзина

### Корневой элемент

- data-cart-form — обязательный атрибут тега form: <form data-cart-form action="{{ cart_items }}" method="post">
- data-reload-on-coupon="false" — отключить перезагрузку страницы после применения купона.

### Вложенные элементы

- data-item-id — обязательный для позиций, ID позиции.
- data-product-id — обязательный для инициализации товара, ID товара.
- data-quantity / data-quantity-change — обёртка количества; имя инпута cart[quantity][{{item.id}}].
- data-cart-item-price — цена позиции.
- data-cart-item-total-price — итоговая цена позиции с учётом количества.
- data-cart-total-price — итог без учёта скидок.
- data-cart-full-total-price — итог с учётом скидок.
- data-cart-positions-count — количество позиций.
- data-cart-item-count — количество товаров.
- data-item-delete="{{ item.id }}" — кнопка удаления позиции.
- data-cart-discounts-ajax — вывод скидок (нужен data-reload-on-coupon="false" на форме).
- data-cart-discounts-error — ошибки купона/скидок.
- data-cart-clear — кнопка очистки корзины.
- data-coupon-submit — кнопка отправки купона (инпут name="cart[coupon]").

### Методы Cart

- Cart.add({ items: {variant_id: qty}, comments: {variant_id: text}, coupon }) — добавление.
  События: before:insales:cart, add_items:insales:cart, add_items:insales:cart:light
  (в order_lines нет product), update_items:insales:cart(:light), always:insales:cart.
- Cart.delete({ items: [variant_id, ...] }) — удаление позиций.
  События: before, delete_items:insales:cart, update_items(:light), always.
- Cart.clear() — полная очистка. События: before, clear_items:insales:cart, update_items(:light), always.
- Cart.forceUpdate() — принудительное обновление данных корзины.
- Cart.remove({ items: {variant_id: qty} }) — удаление заданного количества.
  События: before, remove_items:insales:cart, update_items(:light), always.
- Cart.set({ items: {variant_id: qty} }) — установить количество для каждой позиции.
  События: before, set_items:insales:cart, update_items(:light), always.
- Cart.setCoupon({ coupon }) — установить купон.
  События: before, set_coupon:insales:cart, update_items(:light), always.
- Cart.order.get() — состав корзины.
- Cart.order.getItemByID(id) — информация о позиции по ID.

### События изменения позиции товара

before:insales:item, change_quantity:insales:item, update_variant:insales:item, always:insales:item.
