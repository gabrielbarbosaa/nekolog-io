---
'@nekolog-io/clickhouse': minor
---

Add the search language of specification 4 as a new `@nekolog-io/clickhouse/search` entry: `parseSearch` turns the text into an AST, `compileSearch` turns the AST into SQL, and `searchWhere` wraps that in the project, environment and period filter the server always adds. It lives here rather than in the dashboard because both repositories need the same language, and a second implementation of one grammar diverges on the first corner case.

Nothing a person types reaches the SQL. Every value is a parameter, **including the attribute name** — `@orderId` becomes `attributes[{p1:String}]`, never `attributes['orderId']`, which would be the one injection point in the whole translation. A field that does not exist is an error carrying its position in the text, never a column name arriving from outside. The user's filter always goes in brackets, even when it is a single condition, so no precedence can reach the scope's `AND`; scope parameters are prefixed `s_` and search parameters are always `p<n>`, and `searchWhere` refuses rather than builds if those ever meet. An empty environment list or a reversed period is refused too: a scope that does not scope is a bug, not a filter.

Two behaviours worth knowing: `env:` takes an environment **name** and emits an **id**, so it needs the caller's name-to-id map and errors without one, while a name that is not in the map matches nothing rather than erroring; and only a word of `[A-Za-z0-9_]` goes through `hasToken`, because `hasToken` raises when the needle holds a separator — everything else, and every quoted phrase, goes through `positionCaseInsensitive`.
