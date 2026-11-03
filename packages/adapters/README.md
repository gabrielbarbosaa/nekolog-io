# @nekolog-io/adapters

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

## `RedisClient`

Duas implementações, nenhuma dependência: `upstashRedis({ url, token })` fala a
API REST (serve em Worker, só precisa de `fetch`) e `nodeRedis(client)` recebe
um cliente no formato do `ioredis`, injetado como o `kvKeyStore` recebe o
binding do KV. O pacote não importa o `ioredis`; quem roda self-host é que o
traz.

```ts
const redis = prefixedRedis(nodeRedis(new Redis(process.env.REDIS_URL)), 'prod')
```

**Script roda por hash, não por texto.** As duas implementações guardam o SHA do
`SCRIPT LOAD` e chamam `EVALSHA` depois disso; se o servidor esquecer o script
(reinício, failover), elas recebem `NOSCRIPT`, mandam o texto uma vez e voltam ao
hash. Isso importa no Upstash, onde o plano gratuito conta **comandos**, e o
script do OTP tem dezenas de linhas que seriam reenviadas a cada login.

Erro que não é `NOSCRIPT` sobe: um `READONLY` de réplica não pode virar "mando o
script de novo", porque esconderia o problema real.

**O prefixo por ambiente também vale dentro do script.** O `prefixedRedis`
prefixa os `KEYS` que o `eval` recebe, e **não** os `ARGV` — argumento é dado,
não endereço. Sem isso, `dev` e `prod` dividindo o mesmo Upstash leriam a sessão
um do outro, que é exatamente o que a seção 17 do plano manda evitar.

## `Mailer`

`resendMailer({ apiKey, from })` na nuvem, `smtpMailer({ transport, from })` no
self-host e no Mailpit do desenvolvimento. O `transport` é injetado, no formato
do `nodemailer`; o pacote não o importa.

**Toda mensagem é conferida antes de sair**, nas duas implementações. Quebra de
linha no destinatário ou no assunto é recusada, porque `\r\n` ali forja um
cabeçalho — é como se adiciona um `bcc:` que ninguém vê. O endereço é
normalizado para minúsculas e precisa ser um endereço só: nome de exibição,
vírgula e `<>` são recusados.

A verificação acontece **antes** da chamada de rede, não depois: há teste
afirmando que, com um cabeçalho forjado, nada chegou ao `fetch` nem ao
transporte.

### A allowlist falha fechada

Em `dev` e `qa`, o `EMAIL_ALLOWLIST` limita para quem dá para escrever, e
`allowlistedMailer` recusa o resto. **Lista vazia manda para ninguém**, não para
todo mundo: a variável ausente é a configuração mais provável de uma máquina
nova, e nela o certo é não escrever para estranhos.

A comparação é exata (`ada@example.com`) ou por domínio (`@nekolog.io`). Um
`ada+tag@example.com` **não** passa por `ada@example.com`, e
`ada@example.com.evil.test` não passa por prefixo.

## Publicado no npm

Este pacote é publicado porque o
[`nekolog-dashboard`](https://github.com/gabrielbarbosaa/nekolog-dashboard),
que é um repositório privado, consome o mesmo código — ADR
[0016](../../docs/adr/0016-pacotes-compartilhados-no-npm.md). Ele existe para ser
compartilhado entre os dois repositórios do NekoLog, não como uma API pública de
uso geral; o semver vale do mesmo jeito, e mudança incompatível vira major.

**Dentro deste repositório ele resolve pelo fonte**, não pelo `dist/`: o
`exports` do `package.json` aponta para `./src/`, e o mapeamento para `dist/`
fica no `publishConfig`, que o `pnpm pack` aplica na hora de publicar. É o que
deixa os CLIs e os apps carregarem `.ts` direto, sem build. Por isso o script de
`lint` empacota antes de rodar `publint` e `attw`: é o tarball que precisa ser
conferido, não o diretório.

O pacote é **ESM apenas**. Os consumidores são Node 24, Workers e Next, todos
ESM, e o `attw` roda com `--profile esm-only` — o aviso de "require resolveu
para um arquivo ESM" é o resultado esperado, não uma falha.
