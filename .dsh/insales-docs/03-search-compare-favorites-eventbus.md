# common.v2.js — поиск, сравнение, избранное, EventBus (сырая документация, часть 3)

Источник: официальная документация InSales, скопировано пользователем.

## Живой поиск

Атрибуты (все на теге form):
- data-search-field — поле ввода поискового запроса.
- data-search-result — блок для результата.
- [name="lang"] — текущий язык.

Разметка:

<form action="/search" method="get">
  <input type="hidden" name="lang" value="{{ language.locale }}">
  <input type="text" name="q" value="" placeholder="Поиск" data-search-field />
  <button type="submit">Поиск</button>
  <div data-search-result></div>
</form>

AjaxSearch.setConfig({ letters: 3, delay: 300, hide_items_out_of_stock: true })
- letters — с какого символа начинать поиск; delay — задержка между запросами;
  hide_items_out_of_stock — скрывать товары не в наличии.

События: before:insales:search, update:insales:search, always:insales:search.

## Сравнение

Страница /compares; шаблон templates/compare.liquid, товары в Liquid-переменной products.
Добавляются только товары, выбранные варианты не сохраняются.

Атрибуты:
- data-compare-add="{{ product.id }}" — добавление; класс compare-added.
- data-compare-delete="{{ product.id }}" — удаление; класс compare-not-added.
- data-compare-trigger="{{ product.id }}" — переключатель; классы compare-added/compare-not-added;
  дочерний элемент data-compare-trigger-added-text / -not-added-text меняет текст.
- data-compare-clear — очистка всех.
- data-compare-counter-btn — ссылка на /compares; класс compare-empty когда пусто.
- data-compare-counter — счётчик.

Методы Compare:
- Compare.getCompare() — текущее состояние.
- Compare.add({ item: 123456 }); Compare.remove({ item: 123456 }); Compare.clear(); Compare.update().

События: before/always:insales:compares, update_items:insales:compares, add_item:insales:compares,
remove_item:insales:compares, overload:insales:compares (максимум товаров).

## Избранное

Страница /favorites; шаблон templates/favorite.liquid, товары в products. Только товары, варианты
не сохраняются. Список хранится в аккаунте пользователя (одинаков на всех устройствах).
Кэшируется на 15 секунд — счётчик может показывать старые значения при быстрых изменениях.

Атрибуты:
- data-ui-favorites-add / -delete / -trigger="{{ product.id }}" — классы favorites-added /
  favorites-not-added; текст через data-ui-favorites-trigger-added-text / -not-added-text.
- data-ui-favorites-clear — очистить всё.
- data-ui-favorites-counter-btn — ссылка на /favorites; класс favorites-empty.
- data-ui-favorites-counter — счётчик.

Методы FavoritesProducts:
- getFavoritesProducts() — состояние.
- add({ item }); remove({ item }); clear — документировано как FavoritesProducts.remove() (вероятно
  опечатка в доках, семантия «очистить избранное»); update().

События: before/always:insales:favorites_products, update_items:insales:favorites_products,
add_item:insales:favorites_products, remove_item:insales:favorites_product (без _products — как в доках),
overload:insales:favorites_products.

## EventBus

Pub/Sub на Deferred: несколько обработчиков на событие; обработчики срабатывают, даже если событие
произошло раньше подписки; порядок объявления издателя/подписчика не важен.

- EventBus.subscribe(eventId, callback) — в данных подписчика всегда есть объект action со свойством
  method и доп. сведениями (jQuery-узел, обновлённые данные компонента Cart/Products и т.д.).
- EventBus.publish(eventId, data) — публикация; data преимущественно Object.
- EventBus.logger.add(componentTitle) — логгер компонента; компоненты: cart, product, search,
  compares, favorites_products, quick_checkout.
