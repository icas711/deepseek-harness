# common.v2.js — финал: заказ в 1 клик, Trigger Events, Lodash шаблоны, UI, хелперы, reCaptchaCommon (часть 5)

Источник: официальная документация InSales, скопировано пользователем.

## Формы заявки и заказа в один клик

Формы аналогичны, отдаются сервером вместе с HTML, реализованы как модальные окна — описана
только активация.

- Заказ в 1 клик: <button data-quick-checkout='[data-product-id="12345678"]'>.
- Форма заявки: то же + data-quick-checkout-modal-handle="service".
- Без товара: data-quick-checkout='fake_order' (+ data-quick-checkout-fake-order-name="имя"
  для собственного наименования заглушки).

## Trigger Events

data-trigger-click="my_button:insales:site" — слушатель клика, публикует EventBus-событие;
в подписчике data.event_target — элемент, по которому кликнули.

## Lodash шаблоны (Template)

- Разметка: <script type="text/template" data-template-id="...">...</script>.
- Template.load(template_body, template_id) — загрузка шаблона из JS.
- Template.render(templateData, template_id) — рендер в HTML-строку.

## Методы для работы с UI (InSalesUI)

- InSalesUI.initAjaxInstance($node) — инициализация формы корзины (например, после перерендера
  шаблоном). Пример: подписка на update_items:insales:cart, Template.render(cart, "dynamic_basket"),
  затем initAjaxInstance. В шаблоне dynamic_basket: order_lines, value.id/product_id/title/
  first_image.medium_url/sale_price/quantity, Shop.money.format, total_price, data-item-id,
  data-product-id, data-quantity, data-quantity-change, cart[quantity][id], data-item-delete,
  data-cart-submit; форма data-ajax-cart (в примере; ранее в доках корзины data-cart-form).
- InSalesUI.bindUpdateCart — обновление слушателей quantity в форме корзины.

## Вспомогательные методы (Shop)

- Shop.money.format(1234.00) -> "1234 руб." — форматирование по настройкам админ-панели.
- Shop.config.getProducId() — product-id на странице товара, иначе null (имя метода с опечаткой
  в доках — именно getProducId).
- Shop.config.get() — конфигурация.

## reCaptchaCommon API

- reCaptchaCommon.render(recaptchaBlock, formType) — загрузка скрипта ReCaptcha (если не загружен)
  и рендер в DOM-элементе (элемент обязан быть пустым). formType: 'feedback' | 'comment' | 'review'.
  Без аргументов — только загрузка скрипта. data-recaptcha-type="invisible" на блоке — рендер v3.
  Перед отправкой взять value из [name="g-recaptcha-response"].
- reCaptchaCommon.executeInvisible(form, callback, formType) — v3: находит виджет; если
  верифицирована — возвращает токен; иначе execute и null (отменить отправку), после верификации
  callback(form, token). Для v3 нужно скрытое поле name="recaptcha_type" value="invisible".
  data-badge: inline | bottomleft | bottomright.
- CSRF: токен из meta[name='csrf-token'], $.ajaxSetup({ headers: { 'X-CSRF-Token': token } }),
  отправка $.post('/client_account/feedback.json', feedback).

Полные примеры форм и JS — references скила insales-helpers.
