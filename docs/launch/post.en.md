# NekoLog 1.0: a logging platform I built to find out what breaks

I spent the last few months building a logging platform for JavaScript and
TypeScript applications, end to end: the SDKs, the ingestion API, the storage,
the background jobs, the alerting, the public read API and the documentation.
It is at 1.0 today and the source is MIT.

Two things up front, because they change how you should read the rest.

**Nothing is published to npm and there is no hosted service.** There is no
account to create. The publishing workflow is wired and waits on a repository
variable that does not exist; the infrastructure is written in OpenTofu and has
never been applied. What you can do today is run the whole thing yourself:

```bash
git clone https://github.com/gabrielbarbosaa/nekolog-io
cd nekolog-io/deploy/self-host
./up.sh
```

**The dashboard is closed-source.** This is open-core, and the line is drawn at
the screens. Everything that touches your data — the SDKs, the ingestion, the
redaction, the storage, the alerting, the read API — is open and auditable. The
dashboard is not, and self-host does not include it. I would rather say that in
the first paragraph than have you find out in paragraph nine.

## What it is

SDKs batch what your application already writes and send it over HTTPS. A Hono
app on Cloudflare Workers validates it, strips what should not have left your
process, fingerprints the errors and writes to ClickHouse. A cron Worker wakes
every minute to evaluate alerts, group errors into issues, enforce quotas and
run exports. A read API answers search, histograms and issues over HTTP.

Twelve SDKs over one core: browser, Node, React, Next, Express, Fastify, Hono,
NestJS, bridges for pino and winston, a CLI and a bundler plugin. If you already
run OpenTelemetry you need none of them — `POST /v1/otlp/logs` takes OTLP/HTTP
and converts it before anything else runs, so an OTLP record goes through
exactly the same validation and redaction as a native one.

The whole thing is designed to fit free tiers: Cloudflare Workers, KV and R2, an
Oracle Always Free VM for ClickHouse, Neon, Upstash, Vercel, Resend. The only
cost is the domain.

## The parts worth reading about

None of what follows came from thinking. All of it came from running the thing
and then looking at what actually happened, which turned out to be the only
method that worked.

### A free Cloudflare Worker gives you 10 ms of CPU, and a load test cannot see it

I ran k6 against the ingestion and the numbers were fine. Latency fine,
throughput fine, no errors. Then I measured CPU directly, because a load test
measures how long a request takes from outside and the Worker limit is how much
CPU it burns inside.

The biggest batch the protocol allows — 500 events, 20% of them errors, gzipped,
every redaction rule on — cost **10.8 ms** against a 10 ms limit. It did not
fit, and nothing in the load test said so.

Two changes. The error fingerprint is now memoized per batch, keyed on the exact
text that gets hashed, so a burst of one repeated error costs one SHA-256
instead of a hundred — and the map lives for one batch, never globally, because
a long-lived isolate would keep one that only grows. And the client's default
batch dropped from 500 to 200 events; the protocol still allows 500, but the
default client no longer sends the worst case without anyone choosing it.
Afterwards: 9.1 ms for 500, 2.1 ms for 200.

I deliberately did not optimise the redaction, which is the second biggest cost.
Every plausible optimisation there is a heuristic that skips values, and a
privacy control that quietly stops redacting is worse than one that
over-redacts.

### The same load test then measured nothing at all

The first real run accepted **259,600 events**. I counted the rows in
ClickHouse: **200**.

ClickHouse deduplicates inserts on a token, and the token here is
`<environmentId>:<batchId>`. My k6 script was resending one fixture, so every
iteration after the first was correctly discarded as a replay. The ingestion was
right and the test was wrong. The script now mints a batch id per iteration.

That one cost me an afternoon and taught me the rule I now apply everywhere: a
load run that does not count the rows afterwards has measured nothing. The
report said success. The table said otherwise.

### A regular expression is a denial of service you write for yourself

Server-side redaction lets each environment turn on named patterns — e-mail,
IPv4, CPF, JWT, `Bearer`, credit card. Named, from a closed list. You cannot
supply your own regex, and a database constraint refuses a rule whose key is
called `regex` or `pattern`.

That is not bureaucracy, and I know because I wrote the bad regex myself. The
first e-mail pattern took **266 ms** over 16 KB of `1-1-1-1-…`, because
`[A-Za-z0-9._%+-]+@` backtracks the entire run from every starting position. On
a 10 ms budget that is the ingestion stopping. Bounding the local part to 64
characters — which is RFC 5321's own limit, so it costs nothing real — took it
to 9.2 ms, and all ten patterns together now cost 5.8 ms on the worst shape I
could construct.

Letting a tenant paste a regex into that path would have been handing them a
button that stops the platform.

### A 64-bit integer does not fit in a JavaScript number

Error fingerprints are `UInt64`. Running the stack produced
`9798706835935588000` where the row held `9798706835935588174`: ClickHouse
answered with an unquoted number and `JSON.parse` rounded it. Every reader in
this codebase is JavaScript, so `output_format_json_quote_64bit_integers` is now
on by default for reads, and a caller that genuinely wants a number asks for it.

Reading it is the only reason I know. Nothing failed; a digit changed.

### The browser SDK misses its own size budget, and that is written down

The target was 5 kB gzip. `init` is **12.05 kB**; `createLogger` alone is
**9.4 kB**. `@nekolog-io/core` is 74% of that and is already tree-shaken — 40 kB
of source becomes 17.5 kB in the bundle — and what remains is the privacy
pipeline: the Luhn check, the CPF check digit, the attribute flattener, retry
with backoff, sampling.

Getting to 5 kB would mean cutting the privacy filter, which is a requirement,
not a feature. So the budget is missed, `size-limit` holds the numbers where
they are so they cannot creep, and the miss is written in the plan with the
measurement next to it. Rounding that away would have been the easy thing and
the dishonest one.

### The release machinery had never run

Cutting 1.0 was the first time `changeset version` ran in this repository. It
failed on its first command: changesets treats a private package as ignored and
refuses a changeset naming an ignored and a non-ignored package together — which
most of mine did, because a feature usually touches a package and an app.
Sixty-eight changesets had piled up since the first commit, and the first real
release would have stopped at its first command.

Every package now also ships a CycloneDX bill of materials built from the
lockfile and attached to its own GitHub Release, which turned a promise into a
check: `core`, `cli` and `adapters` claim zero runtime dependencies, and until
now that claim lived only in prose. The lockfile answers it, and a transitive
dependency arriving through a package they already use fails the release.

Publishing itself uses npm trusted publishing, so there is no token in the
repository or in its secrets to leak.

## What it does with your data

The IP address is never written — not hashed, not truncated. The row carries the
country, and a test sends `CF-Connecting-IP` and `X-Forwarded-For` and fails if
either reaches storage.

Sensitive values are stripped inside your process, before the network call, by
key and by value in free text, and that pass runs **after** your own
`beforeSend`, so a hook cannot undo it. Then again on the server, from the
closed list above. A click breadcrumb records `button#pay` — the selector —
never the element's text, because a label can name a person. `page.url` drops
the query string, because reset tokens and invite codes live there.

## What it is not

It is a portfolio project. One maintainer, built against a written plan, with
every architectural decision recorded as an ADR including the ones that were
later reversed. It is not a product, there is no company behind it, and I am not
asking you for an e-mail address.

If you want to look: the
[plan](https://github.com/gabrielbarbosaa/nekolog-io/blob/main/docs/PLANO.md) is
the what and the why, the
[roadmap](https://github.com/gabrielbarbosaa/nekolog-io/blob/main/docs/ETAPAS.md)
is the order it was built in — one step, one branch, one pull request — and the
[threat model](https://github.com/gabrielbarbosaa/nekolog-io/blob/main/docs/security/threat-model.md)
records what was accepted without full mitigation and why.

**Source:** https://github.com/gabrielbarbosaa/nekolog-io
**Docs:** https://nekolog.io/docs/

---

## For Show HN

**Title** (80 characters maximum, so this fits with room to spare):

> Show HN: NekoLog – open-core logging for JS/TS, self-hostable in one command

**First comment** — HN wants the context in a comment, not in the title. Post
the section *The parts worth reading about* above, cut to the first three
findings, followed by:

> It is a portfolio project: one maintainer, no company, nothing published to
> npm yet and no hosted service. What works today is the self-host. The
> dashboard is closed-source and is not part of it, which I would rather say
> here than have you find out later.
>
> Happy to answer anything about the Worker CPU budget, the ClickHouse
> deduplication, or why the browser SDK is 12 kB instead of the 5 kB I aimed at.
