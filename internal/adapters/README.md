# @internal/adapters

As interfaces que isolam o resto do código de qualquer fornecedor — princípio 2
do [PLANO](../../docs/PLANO.md): o mesmo código roda na nuvem gratuita e no
self-host.

| Interface | Nuvem | Self-host |
|---|---|---|
| `KeyStore` | Workers KV | memória, Postgres |
| `RateLimiter` | contador no Worker | Redis/Valkey |
| `BlobStore` | Cloudflare R2 | Garage, qualquer S3 |
| `Mailer` | Resend | SMTP |
| `LogStore` | ClickHouse pelo Tunnel | ClickHouse local |
| `RedisClient` | Upstash | Valkey |

A maioria ainda é só a interface. As **keys** já têm implementação, porque a
ingestão precisa delas.

## Keys

```ts
const store = cachedKeyStore(kvKeyStore(env.KEYS))
const record = await store.get(await hashApiKey(key))
```

- `parseApiKey` / `generateApiKey` — o formato `nekolog_pk_…` e `nekolog_sk_…`
  (ADR [0006](../../docs/adr/0006-keys-por-ambiente.md)). O parser recusa
  prefixo errado, segredo curto demais, longo demais ou fora de
  `[A-Za-z0-9_-]`, e não aceita uma key que apenas *contém* o prefixo no meio
  de outro texto.
- `hashApiKey` — SHA-256 em hex, pela Web Crypto, então roda em Worker e em
  Node sem adaptação. É por esse hash que a busca acontece: a key em claro
  nunca é guardada.
- `memoryKeyStore` — self-host pequeno e testes.
- `kvKeyStore` — Workers KV, com prefixo `key:` para a KV poder guardar outras
  coisas. Um registro corrompido é tratado como **ausente**, e um escopo
  desconhecido vindo do KV é descartado em vez de confiado.
- `cachedKeyStore` — 60 s de cache em memória, com teto de entradas e cache
  também do "não existe". Escrever ou apagar por ele invalida na hora.
- `originAllowed` / `originMatches` — a lista de origens das keys públicas,
  com curinga de subdomínio que confere esquema e sufixo. Os casos que o erro
  clássico deixa passar (`aexample.com` por `*.example.com`) têm teste próprio.

## Por que isso aqui e não no `apps/ingest`

O dashboard também cria e revoga key, e os jobs também marcam ambiente
bloqueado. O formato, o hash e a `KeyStore` são contrato entre os três, não
detalhe de um.
