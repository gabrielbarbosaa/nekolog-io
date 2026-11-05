---
"@apps/web": minor
"@apps/docs": patch
---

The landing page says what the project is.

`apps/web` was proof that the theme, the locale cookie and the i18n wiring
worked — a title, a tagline and two toggles. It is now a page: what the platform
does, where the open-core line is drawn and why, what it does with your data,
and a section of numbers that were measured rather than claimed, including the
5 kB size budget the browser SDK **misses**.

Two things keep it honest. `apps/web/tests/claims.test.ts` pins every number on
the page, in all three locales, to the constant that enforces it — the Worker's
10 ms budget, the 500 and 200 event batches, the `size-limit` ceiling, Node 22 —
and splits the published packages into the twelve SDKs and the five shared ones,
so a thirteenth package has to be classified rather than silently making
"12 SDKs" wrong. And `messages.test.ts` now fails on a translation that is still
the English sentence, which it could not see before: it compared keys, not
values.

`apps/docs` gains a test over its own code samples. The self-host guide shipped
`createLogger({ key, endpoint })` in all three languages and neither option
exists — it only looked right because that example also exports `NEKOLOG_KEY`
and `NEKOLOG_ENDPOINT`, which the SDK reads by itself. Every `createLogger` call
in the documentation is now checked against the option names declared in
`LoggerOptions`, read from the type rather than copied from it.
