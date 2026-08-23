# Форма обратной связи: полный пример

```liquid
<form method="post" action="/client_account/feedback" data-feedback-form-wrapper>
  <div data-feedback-form-success='{"showTime": 10000}' class="success-message">Успешно отправлено</div>

  <div data-feedback-form-field-area>
    <div>Телефон</div>
    <input
      name="phone"
      data-feedback-form-field='{
        "isRequired": true,
        "errorMessage": "Неправильно заполнено поле Телефон",
        "phoneNumberLength": 11
      }'
      type="text"
      autocomplete="off"
      value="" />
    <div data-feedback-form-field-error></div>
  </div>

  <div data-feedback-form-field-area>
    <div>Имя</div>
    <input
      name="name"
      data-feedback-form-field='{"isRequired": true, "errorMessage": "Неправильно заполнено поле Имя"}'
      type="text"
      value="" />
    <div data-feedback-form-field-error></div>
  </div>

  <div data-feedback-form-field-area>
    <div>Текст</div>
    <textarea name="content" data-feedback-form-field='{"errorMessage": "Неправильно заполнено поле Текст"}'></textarea>
    <div data-feedback-form-field-error></div>
  </div>

  <div data-feedback-form-field-area>
    <div>email</div>
    <input
      name="from"
      data-feedback-form-field='{"errorMessage": "Неправильно заполнено поле email"}'
      type="text"
      value="" />
    <div data-feedback-form-field-error></div>
  </div>

  <div data-feedback-form-field-area>
    <label>
      <input
        data-feedback-form-agree='{"errorMessage": "Необходимо подтвердить согласие"}'
        type="checkbox"
        name="agree"
        value="" />
      Согласен на обработку данных
    </label>
    <div data-feedback-form-field-error></div>
  </div>

  {% if settings.feedback_captcha_enabled %}
    <div data-feedback-form-field-area class="feedback__field-area">
      <div data-feedback-form-recaptcha='{
        "isRequired": true,
        "errorMessage": "{{ messages.recaptcha_error | escape }}"
      }' class="feedback__recaptcha"></div>
      <div data-feedback-form-field-error class="feedback__field-error"></div>
    </div>
  {% endif %}

  <input type="text" value="Форма обратной связи" name="subject" />
  <div>
    <button class="button" type="submit">Отправить</button>
  </div>
</form>
```

## Google reCaptcha v3 (invisible)

```liquid
{% if settings.feedback_captcha_enabled %}
  <div data-feedback-form-field-area class="feedback__field-area">
    <div
      data-recaptcha-type="invisible"
      data-badge="bottomleft"
      data-feedback-form-recaptcha='{
        "isRequired": true,
        "errorMessage": "{{ messages.recaptcha_error | escape }}"
      }'
      class="feedback__recaptcha"
    ></div>
    <div data-feedback-form-field-error class="feedback__field-error"></div>
  </div>
{% endif %}
```

## Yandex SmartCaptcha (обычная, тестовая, invisible)

```liquid
{% if settings.feedback_captcha_enabled %}
  <div data-feedback-form-field-area class="feedback__field-area">
    <div
      data-feedback-form-yandex-captcha='{
        "isRequired": true,
        "errorMessage": "{{ messages.yandex_captcha_error | escape }}"
      }'
      class="feedback__yandex-captcha"
    ></div>
    <div data-feedback-form-field-error class="feedback__field-error"></div>
  </div>
{% endif %}
```

Тестовый режим: добавить `data-yandex-captcha-test="true"`. Invisible: добавить `data-yandex-captcha-type="invisible"` и при желании `data-yandex-captcha-shield-position="bottom-left"`; скрыть бейдж — `data-yandex-captcha-hide-shield="true"` (тогда уведомите пользователей об обработке данных SmartCaptcha иным способом).

## Кнопка модального окна

```liquid
<button data-show-feedback-modal='{"modal_id": "123456"}'>Обратная связь</button>
```

```js
EventBus.subscribe('show-modal-feedback:insales:ui_feedback', (data) => {
  console.log(data);
});
```
