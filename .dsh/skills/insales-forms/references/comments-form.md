# Форма комментария к статье: полный пример

```liquid
{% if blog.comments_enabled? %}
<form
  class="comment-form"
  method="post"
  data-comments-form-wrapper='{
    "reviews_moderated": {{ account.reviews_moderated? }},
    "url": "{{ article.url }}"
  }'
  action="{{ article.url }}/comments#comment_form"
>
  <div
    data-comments-form-success='{
      "showTime": 10000,
      "message": "Добавлен"
    }'
    class="h4 feedback__success-message"
  ></div>

  <div class="reviews-wrapper {% unless comment.errors.size > 0 %}hidden{% endunless %}">
    <div class="review-form-header">
      <div class="review-form-title">{{ widget_messages.review_write_new_title }}</div>
      <span class="button-link hide-form-btn js-hide-form">{{ widget_messages.review_write_new_cancel }}</span>
    </div>
    <div class="reviews-form">
      <div id="comment_form" class="js-review-wrapper">
        <div
          data-comments-form-field-area
          class="form-row form-author is-required {% if review.errors contains 'author' %}is-error{% endif %}"
        >
          <label class="form-label">{{ widget_messages.field_name }} <span class="text-error">*</span></label>
          <input
            name="comment[author]"
            placeholder="{{ widget_messages.field_name }}"
            value="{{ review.author }}"
            type="text"
            class="form-control form-control_size-m"
            data-comments-form-field='{"isRequired": true, "errorMessage": "ошибка"}'
          />
          <div data-comments-form-field-error class="feedback__field-error"></div>
        </div>

        <div
          data-comments-form-field-area
          class="form-row form-email is-required {% if review.errors contains 'email' %}is-error{% endif %}"
        >
          <label class="form-label">{{ widget_messages.field_email }} <span class="text-error">*</span></label>
          <input
            name="comment[email]"
            placeholder="{{ widget_messages.field_email }}"
            value="{{ review.email }}"
            type="text"
            class="form-control form-control_size-m"
            data-comments-form-field='{"isRequired": true, "errorMessage": "ошибка"}'
          />
          <div data-comments-form-field-error class="feedback__field-error"></div>
        </div>

        <div
          data-comments-form-field-area
          class="form-row form-comment is-required {% if review.errors contains 'content' %}is-error{% endif %}"
        >
          <label class="form-label">{{ widget_messages.field_message }} <span class="text-error">*</span></label>
          <textarea
            name="comment[content]"
            placeholder="{{ widget_messages.field_message }}"
            class="form-control form-control_size-m is-textarea"
            data-comments-form-field='{"isRequired": true, "errorMessage": "ошибка"}'
          >{{ comment.content }}</textarea>
          <div data-comments-form-field-error class="feedback__field-error"></div>
        </div>

        {% if comment.captcha_enabled? %}
          <div
            data-comments-form-field-area
            class="form-row form-captcha {% if comment.errors contains 'captcha_solution' %}is-error{% endif %}"
          >
            <div
              data-recaptcha-type="invisible"
              data-comments-form-recaptcha='{
                "isRequired": true,
                "errorMessage": "{{ messages.recaptcha_error | escape }}"
              }'
              id="captcha_challenge"
              class="captcha-recaptcha"
            ></div>
            <div data-comments-form-field-error class="form__field-error"></div>
          </div>
        {% endif %}

        <div class="form-controls">
          <button type="submit" class="button button_size-m">{{ widget_messages.button_submit }}</button>
        </div>
      </div>

      {% if blog.moderated? %}
        <div class="moderation">
          <p>{{ widget_messages.reviews_are_moderated }}</p>
        </div>
      {% endif %}
    </div>
  </div>
</form>
{% endif %}
```

## Yandex SmartCaptcha

Аналогично feedback/reviews: `data-comments-form-yandex-captcha` (+ `data-yandex-captcha-test`, `data-yandex-captcha-type="invisible"`, `data-yandex-captcha-shield-position`, `data-yandex-captcha-hide-shield`).

## Кнопка модального окна

```liquid
<button data-show-comments-modal='{"modal_id": "123456"}'>Форма комментария к статье</button>
```

```js
EventBus.subscribe('show-modal-comments:insales:ui_comments', (data) => {
  console.log(data);
});
```
