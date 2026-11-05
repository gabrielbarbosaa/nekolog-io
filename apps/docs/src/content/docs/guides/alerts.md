---
title: Alerts
description: Rules evaluated every minute, and the channels they reach — including how to verify a webhook really came from NekoLog.
---

A rule is a [search](/docs/api/search/), a window and a threshold. Every minute
a job measures each rule of each environment and, when the answer crosses, sends
one notice to the channels the rule names. You create them in the dashboard;
what follows is what runs.

## The five kinds

| Type | Fires when |
|---|---|
| `threshold` | the count of logs matching the search, in the window, passes the value |
| `error_rate` | the share of `error` and `fatal` in the window passes the value, above a `minEvents` floor so a quiet service does not alert on one line |
| `new_issue` | an issue appears in the environment for the first time |
| `issue_regression` | an issue that was resolved happens again |
| `absence` | **nothing** matching the search arrived during the window — a service that stopped reporting |

Windows are `1m`, `5m`, `15m` or `1h`.

```json
{
  "type": "threshold",
  "query": "level:error service:api",
  "window": "5m",
  "operator": ">",
  "value": 50,
  "cooldown": "30m",
  "channels": ["ch_01J9X…"]
}
```

The condition carries **no environment**. The environment is a column on the
rule, and it is half of the foreign key that stops a rule from one project
pointing at another project's environment. A second copy inside the JSON would
be a second truth no constraint reaches, so one is refused.

## Firing, and stopping

A rule holds two states, `ok` and `firing`. "Resolved" is the return to `ok`,
and it sends a notice too — being told something broke and never told it was
fixed is worse than one message too many.

The `cooldown` holds back a **repeat of the firing notice**, counted from the
last firing notice that actually went out. It never holds the all-clear. A
notice held back is still recorded, marked as suppressed, so a screen can say
why nobody was told.

Three refusals worth knowing:

- **A measurement that failed never resolves a rule.** "I could not measure" is
  not "it stopped".
- **A stored condition that no longer parses throws** instead of being evaluated
  as a guess.
- Every state change is written **in the same statement** that moves the rule, so
  a run that dies between the two cannot exist, and a replay is harmless.

## Channels

E-mail, Discord and a webhook of your own. The notice carries the rule's name,
the environment, the measured value and the threshold, and a link to the
Explorer with the search and the period already filled in, in the language of
whoever receives it.

### Verifying a webhook

Every webhook request carries `X-NekoLog-Signature`: `sha256=` followed by the
HMAC-SHA256 of the **raw body** with the channel's secret, which is 32 bytes the
server generated.

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function fromNekolog(rawBody, header, secret) {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  return header
    .split(',')
    .map((one) => one.trim())
    .some((one) => {
      const a = Buffer.from(one)
      const b = Buffer.from(expected)
      return a.length === b.length && timingSafeEqual(a, b)
    })
}
```

Compute it over the bytes you received, not over a re-serialised object.

**During a secret rotation the header carries two signatures**, separated by a
comma, **current first** — the shape GitHub and Stripe use, so a receiver that
checks either one keeps working. It never carries three: a window that
accumulates is a window nobody closes.

### Where a webhook may point

The address is checked when the channel is saved **and again at send time**,
because a row can be older than the guard. It must be `https` on port 443, and
these are refused:

- credentials in the URL;
- `localhost`, `*.local`, `*.internal`, `*.lan`, `*.home.arpa`, `*.in-addr.arpa`;
- the cloud metadata hosts;
- a bare name with no dot, which can only exist inside this network;
- every private and reserved IPv4 and IPv6 range.

The request goes out with `redirect: 'manual'` — a public address answering
`302` to a private one is the classic bypass — and gives up after five seconds.

## What is never sent

The notice names the rule and the environment and links to the Explorer. It does
**not** carry log content. A secret stored on a channel is encrypted at rest with
the channel's id as additional authenticated data, so a secret copied into
another row does not open.
