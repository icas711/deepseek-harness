# Селектор модификаций: исходники шаблонов

Все шаблоны — lodash-разметка внутри `<script type="text/template" data-template-id="...">`. Собственный шаблон объявляется так же и подключается через `"default": "<id>"` в `data-product-variants` или через `Products.setConfig({ options: { '<имя опции>': '<id>' } })`.

Доступные данные шаблона: `classes` (option/label/values, value.classes.all/state), `title`, `values[]` (controls, state, title, titleWithoutQuotes, image_url, imageFromVariant.medium_url, variant.image_id), `option.id`, `option.handle`, `handle`.

## select

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

## select-image

Если у значений есть `image_url` — рисует радиокнопки с картинками, иначе обычный select.

```html
<script type="text/template" data-template-id="option-select-image">
  <div class="<%= classes.option %> <%= _.find(values, 'image_url') ? 'is-system-color' : '' %> is-select">
    <% if (_.find(values, 'image_url')) { %>
      <label class="<%= classes.label %>"><%= title %></label>
      <div class="<%= classes.values %>">
        <% _.forEach(values, function (value){ %>
          <label class="<%= value.classes.all %> is-radio">
            <input class="<%= value.classes.state %>" type="radio" name="<%= handle %>" <%= value.state %> <%= value.controls %>>
            <span class="option-value-system-color <%= value.image_url ? 'with-image-color' : 'without-image-color' %>">
              <% if (value.image_url) { %>
                <img width="40px" src="<%= value.image_url %>" alt="<%= value.titleWithoutQuotes %>" title="<%= value.titleWithoutQuotes %>">
              <% } else { %>
                <%= value.title %>
              <% } %>
            </span>
          </label>
        <% }) %>
      </div>
    <% } else { %>
      <label class="<%= classes.label %>"><%= title %></label>
      <select class="<%= classes.values %>" data-option-bind="<%= option.id %>">
        <% _.forEach(values, function (value){ %>
          <option <%= value.controls %> <%= value.state %>><%= value.title %></option>
        <% }) %>
      </select>
    <% } %>
  </div>
</script>
```

## span

```html
<script type="text/template" data-template-id="option-span">
  <div class="<%= classes.option %> is-span">
    <label class="<%= classes.label %>"><%= title %></label>
    <div class="<%= classes.values %>">
      <% _.forEach(values, function (value){ %>
        <button class="<%= value.classes.all %> is-span" <%= value.controls %> <%= value.state %>>
          <%= value.title %>
        </button>
      <% }) %>
    </div>
  </div>
</script>
```

## radio

```html
<script type="text/template" data-template-id="option-radio">
  <div class="<%= classes.option %> is-radio">
    <label class="<%= classes.label %>"><%= title %></label>
    <div class="<%= classes.values %>">
      <% _.forEach(values, function (value){ %>
        <label class="<%= value.classes.all %> is-radio">
          <input class="<%= value.classes.state %>" type="radio" name="<%= handle %>" <%= value.state %> <%= value.controls %>>
          <span><%= value.title %></span>
        </label>
      <% }) %>
    </div>
  </div>
</script>
```

## preview

Показывает картинку варианта (`value.imageFromVariant.medium_url`), если есть.

```html
<script type="text/template" data-template-id="option-preview">
  <div class="<%= classes.option %> option-<%= option.handle %>" is-span is-preview">
    <label class="<%= classes.label %>"><%= title %></label>
    <div class="<%= classes.values %>">
      <% _.forEach(values, function (value){ %>
        <button class="<%= value.classes.all %> is-span is-preview" <%= value.controls %> <%= value.state %>>
          <% if(value.imageFromVariant){ %>
            <img width="40px" src="<%= value.imageFromVariant.medium_url %>" alt="<%= value.titleWithoutQuotes %>" title="<%= value.titleWithoutQuotes %>">
          <% }else{ %>
            <span><%= value.title %></span>
          <% } %>
        </button>
      <% }) %>
    </div>
  </div>
</script>
```

## preview-text

Картинка, если у варианта есть `image_id`, иначе текст.

```html
<script type="text/template" data-template-id="option-preview-text">
  <div class="<%= classes.option %> is-span is-preview-text">
    <label class="<%= classes.label %>"><%= title %></label>
    <div class="<%= classes.values %>">
      <% _.forEach(values, function (value){ %>
        <button class="<%= value.classes.all %> is-span is-preview-text <%= (value.variant.image_id ? 'is-img' : 'is-text') %>" <%= value.controls %> <%= value.state %>>
          <% if(value.imageFromVariant && value.variant.image_id){ %>
            <img width="40px" src="<%= value.imageFromVariant.medium_url %>" alt="<%= value.titleWithoutQuotes %>" title="<%= value.titleWithoutQuotes %>">
          <% }else{ %>
            <span><%= value.title %></span>
          <% } %>
        </button>
      <% }) %>
    </div>
  </div>
</script>
```
