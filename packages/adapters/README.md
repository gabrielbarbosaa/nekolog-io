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
- `cachedKeyStore` — 60 s de cache em memória, com teto de entradas. O "não
  existe" também é cacheado, mas por **5 s**, não 60: uma key recém-criada
  chega ao KV no próximo `key-sync`, e um minuto de 401 depois disso tornaria
  impossível o passo a passo do primeiro log. Cinco segundos ainda derrubam
  uma enxurrada de hashes chutados. Escrever ou apagar por ele invalida na hora.
- `firstKeyStore(a, b)` — pergunta na ordem e devolve a primeira resposta;
  escreve só na primeira. É o que deixa o self-host ler o KV e, só depois, o
  `.nekolog-seed.json`.
- `sqlKeyDirectory` / `publishKeys` — o lado que os **jobs** usam: `live()` lê
  do Postgres toda key não revogada com as configurações do ambiente dela, e
  `publishKeys` grava no KV só o que mudou, apaga o que sumiu e mantém o
  documento `keys:index` com um resumo por hash. O índice existe porque um
  `KvNamespace` não se lista: sem ele não haveria como saber o que apagar.
  `stampLastUsed` grava o último uso e **nunca anda para trás**.
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

**O endereço é conferido em linha reta, sem regex ambígua.** A primeira versão
usava `/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/`, e o CodeQL a reprovou como
ReDoS polinomial: as classes aceitam `.`, então `a@!.!.!.…` faz o motor voltar
atrás muitas vezes. Como o destinatário vem de convite e de cadastro, isso é
entrada de terceiro. A versão atual procura o `@` por índice e checa as duas
metades, com um limite de 254 caracteres. Há teste que recusa a entrada
adversarial e mede o tempo.

### A allowlist falha fechada

Em `dev` e `qa`, o `EMAIL_ALLOWLIST` limita para quem dá para escrever, e
`allowlistedMailer` recusa o resto. **Lista vazia manda para ninguém**, não para
todo mundo: a variável ausente é a configuração mais provável de uma máquina
nova, e nela o certo é não escrever para estranhos.

A comparação é exata (`ada@example.com`) ou por domínio (`@nekolog.io`). Um
`ada+tag@example.com` **não** passa por `ada@example.com`, e
`ada@example.com.evil.test` não passa por prefixo.

### Quem já devolveu não recebe de novo

`suppressedMailer(inner, list)` consulta a lista de endereços suprimidos antes
de mandar. Insistir num endereço que deu *hard bounce* ou que marcou como spam é
o jeito mais rápido de o domínio inteiro perder reputação e os e-mails de login
de todo mundo irem para o lixo eletrônico.

Ele também **falha fechado**: se a consulta à lista der erro, nada é enviado.
"Não consigo saber" não pode virar "não está suprimido", pela mesma razão que
vale no `quota-block`. E a conferência de cabeçalho acontece antes da consulta,
então um destinatário forjado é recusado sem nem tocar no banco.

### O webhook de bounce é verificado antes de ser lido

`verifyWebhook({ secret, headers, body })` confere a assinatura no formato que a
Resend usa (Svix): HMAC-SHA256 sobre `id.timestamp.corpo`, comparado em tempo
constante. Sem isso, qualquer um que descobrisse a URL poderia marcar o endereço
de outra pessoa como inválido e cortar o login dela — negação de serviço com um
POST.

Ele recusa também o que a assinatura sozinha não resolve: cabeçalho ausente,
timestamp fora da tolerância de 5 minutos (reenvio de uma captura antiga),
timestamp no futuro, e assinatura que é só um prefixo da certa. Aceita mais de
uma assinatura no mesmo cabeçalho, que é como uma rotação de segredo acontece
sem derrubar nada.

O pacote continua sem dependência: tudo sai da Web Crypto, então roda em Worker
e em Node do mesmo jeito.

## Não vai ao npm

Este pacote é `private: true` e nunca é publicado — ADR
[0019](../../docs/adr/0019-um-repositorio-so.md). A ADR
[0016](../../docs/adr/0016-pacotes-compartilhados-no-npm.md) o tinha publicado
porque o dashboard vivia noutro repositório e precisava instalá-lo; o dashboard
veio para cá, e publicar um pacote de servidor de um produto proprietário
passou a ser entregar o que o produto é.

**Ele resolve pelo fonte**: o `exports` do `package.json` aponta para `./src/`,
que é o que deixa os CLIs e os apps carregarem `.ts` direto, sem build. Não há
mais `publishConfig`, `files`, `build` nem `lint` — tudo isso existia só para
empacotar um tarball e conferi-lo com `publint` e `attw`.

