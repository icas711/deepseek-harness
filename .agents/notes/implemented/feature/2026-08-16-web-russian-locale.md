# Agent Note: Third shipped web locale — Russian

Status: implemented

English | [中文](2026-08-16-web-russian-locale.zh.md)

## Problem

The web client shipped exactly two locales, zh and en, with zh as the per-key fallback and `FALLBACK_LOCALE`. A Russian-speaking user met a Chinese-first surface with no escape except English, and the dictionary canon read as bilingual: `LOCALE_IDS` was `['zh', 'en']`, the typed `register(ns, dicts)` required exactly those two dictionaries, and the settings Language row offered two options. Adding a language therefore touched a typed contract replicated across every UI package, not one dictionary file — doing it ad hoc would either break the compile-time completeness guarantee or bypass it package by package.

## Decision

**`ru` is a third shipped locale with the same authority as zh/en.** `LOCALE_IDS` and the Language row's registry list gain `ru` («Русский», self-described); browser detection matches it on the primary subtag (`ru-RU` → ru) through the existing [browser-derived initial locale](2026-07-31-browser-derived-initial-locale.md) order; `locale.preference` persists it through the Host settings seam. `FALLBACK_LOCALE` stays zh — the fallback is the no-signal answer and the per-key dictionary fallback, not a ranking of languages.

**Completeness stays compile-time.** `register`'s typed arm reads `Record<LocaleId, LocaleDictOf<N>>`, so widening `LOCALE_IDS` turns every existing `{ zh, en }` registration into a compile error until its package ships an ru dictionary — the migration cannot leave a namespace half-translated silently. Every dictionary-bearing package (client UI packages, `ui-cordis`, `session-log-export`, the inline dictionaries of `ui-directory-picker-browse` and `ui-permission-presets`, and `ui-settings-models`' onboarding copy) now registers all three locales; per-package dictionaries keep the `zh` key-set source and `ru satisfies Record<XxxKey, string>` mirrors the en completeness check.

**Terminology policy: natural anglicisms.** ru copy uses the vocabulary Russian developer tools use — «сессия», «модель», «план», «скилл», «воркфлоу», «плагин», «токен» — and infinitive verb buttons («Закрыть», «Создать»); strict literary calques («сеанс», «навык») were avoided deliberately. Date templates reorder named placeholders (`clock.md` = `{d}.{m}`, `clock.ymd` = `{d}.{m}.{y}`), which the named-placeholder interpolation supports without code changes; zh/en templates are untouched.

## Alternatives considered

**Replace zh/en with Russian-only copy.** Rejected: it destroys the bilingual dictionary canon and its compile-time balance, forces a destructive diff through every package, and contradicts the product's existing audience; a third locale is additive.

**Ship `ru` dictionaries without widening the typed contract** (register `ru` through the untyped single-locale arm). Rejected: the untyped arm exists for dynamic composition and tests, not shipped product copy — using it would trade the missing-dictionary compile error for a silent zh fallback in production.

**Add Russian plural categories (`.few`/`.many` keys or ICU plural rules).** Rejected: dictionary key sets are zh-sourced and isomorphic across locales; adding locale-specific keys breaks that invariant and the `makeTranslate` mirror for one grammatical problem. ru `.other` strings use the genitive plural — exact for 5+, approximate for 2–4 (e.g. «2 фоновых задач»).

## Consequences

- A Russian browser gets ru on first visit; the choice persists like the other locales. Switching remains live (revision bump) with zero re-registration, per the [full-rollout locale seat](../architecture/2026-07-30-client-locale-full-rollout.md).
- The e2e lane stays golden-stable (goldens pin `en-US`/`zh-CN` browsers); the assembled-app ru proof is `settings-chrome.e2e.ts`'s Russian-browser scenario, which opens a fresh Host home under `ru-RU` and asserts the Russian settings surface (trigger, dialog, General nav, Language row, selector pill) end to end.
- The known cost is the plural approximation above, plus untranslated surface inherited from the existing boundary: error strings, design literals, and boot copy stay out of the dictionaries in all locales alike.
- Future locales are now a known shape: widen `LOCALE_IDS`, add the dictionaries, fix every compile error the typed register surfaces — the contract does the audit.
