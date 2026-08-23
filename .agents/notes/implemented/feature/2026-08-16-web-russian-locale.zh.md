# Agent Note: 第三个已提供的 web locale——俄语

Status: implemented

[English](2026-08-16-web-russian-locale.md) | 中文

## Problem

web 客户端此前只提供 zh 与 en 两个 locale，zh 既是逐 key 回落又是 `FALLBACK_LOCALE`。俄语用户迎面撞上一个中文优先的界面，唯一的脱身通道是英文；而字典规范整体呈双语形态：`LOCALE_IDS` 为 `['zh', 'en']`，类型化的 `register(ns, dicts)` 恰好要求这两份词典，settings 的语言行也只给两个选项。因此增加一门语言动的是一条在每个 UI 包里复制的类型契约，而非一个词典文件——草率行事要么破坏编译期完整性保证，要么逐包绕开它。

## Decision

**`ru` 是与 zh/en 同等权威的第三个已提供 locale。** `LOCALE_IDS` 与语言行的注册表列表加入 `ru`（«Русский»，以自身语言自述）；浏览器探测按主子标签命中它（`ru-RU` → ru），沿用既有的[浏览器推导初始 locale](2026-07-31-browser-derived-initial-locale.md) 顺序；`locale.preference` 经 Host settings 接缝持久化它。`FALLBACK_LOCALE` 保持 zh——回落值是「完全没有信号」的答案与逐 key 字典回落，不是语言排序。

**完整性保持在编译期。** `register` 的类型化分支读取 `Record<LocaleId, LocaleDictOf<N>>`，因此拓宽 `LOCALE_IDS` 会把每处既有的 `{ zh, en }` 注册变成编译错误，直到该包交付 ru 词典——迁移不可能静默地留下半个翻译的 namespace。所有含词典的包（client UI 包、`ui-cordis`、`session-log-export`、`ui-directory-picker-browse` 与 `ui-permission-presets` 的内联词典、`ui-settings-models` 的 onboarding 文案）现在都注册全部三种 locale；各包词典保持 `zh` 的 key 集源头，`ru satisfies Record<XxxKey, string>` 与 en 的完整性检查同构。

**术语策略：自然英语借词。** ru 文案采用俄语开发者工具的通行词汇——«сессия»、«модель»、«план»、«скилл»、«воркфлоу»、«плагин»、«токен»——按钮用不定式动词（«Закрыть»、«Создать»）；刻意回避严格的文学直译（«сеанс»、«навык»）。日期模板重排命名占位符（`clock.md` = `{d}.{m}`、`clock.ymd` = `{d}.{m}.{y}`），命名占位符插值无需代码改动即可支持；zh/en 模板不受影响。

## Alternatives considered

**以纯俄语文案取代 zh/en。** 不予采用：这会摧毁双语词典规范及其编译期平衡，迫使每个包接受破坏性 diff，也背离产品既有受众；第三个 locale 是纯增量。

**在不拓宽类型契约的情况下交付 `ru` 词典**（经无类型的单 locale 分支注册 `ru`）。不予采用：无类型分支为动态组合与测试而设，不是已交付产品文案的通道——用它等于把「缺词典」的编译错误换成生产环境静默回落 zh。

**为俄语增加复数类别（`.few`/`.many` key 或 ICU 复数规则）。** 不予采用：词典 key 集以 zh 为源头、跨 locale 同构；为某一个语法问题增加 locale 专属 key 会破坏该不变量与 `makeTranslate` 镜像。ru 的 `.other` 字符串使用复数属格——5+ 精确，2–4 近似（如 «2 фоновых задач»）。

## Consequences

- 俄语浏览器首访即得 ru；该选择与其他 locale 一样持久。切换依旧实时（revision 递增）且零重注册，遵循[全量接入的 locale 席位](../architecture/2026-07-30-client-locale-full-rollout.md)。
- e2e 车道保持 golden 稳定（golden 钉死 `en-US`/`zh-CN` 浏览器）；组装后应用的 ru 证据是 `settings-chrome.e2e.ts` 的俄语浏览器场景：在全新 Host home 上以 `ru-RU` 打开页面，端到端断言俄语 settings 界面（触发按钮、对话框、General 导航、语言行、选择器胶囊）。
- 已知代价是上述复数近似，以及既有边界继承的未翻译面：错误字符串、设计字面量与启动文案在所有 locale 下一律不入词典。
- 未来的 locale 从此有了已知形态：拓宽 `LOCALE_IDS`、交付词典、修完类型化 register 抛出的每个编译错误——契约本身完成审计。
