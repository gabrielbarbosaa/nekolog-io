# @internal/clickhouse

Esquema do ClickHouse do NekoLog e o runner que o aplica. Implementa a
[especificação 3](../../docs/ESPECIFICACOES.md#3-runner-de-migrations-do-clickhouse)
e cria as tabelas da [seção 7 do plano](../../docs/PLANO.md#7-modelo-de-dados).

Pacote interno: não vai para o npm.

## Pontos de entrada

| Import | O que traz | Roda em |
|---|---|---|
| `@internal/clickhouse` | tudo, inclusive o runner | Node |
| `@internal/clickhouse/client` | só o cliente HTTP | qualquer runtime |
| `@internal/clickhouse/log-store` | o `LogStore` da ingestão | qualquer runtime |

A separação existe porque o runner lê arquivos do disco (`node:fs`), e a
ingestão roda em Cloudflare Workers, onde isso não existe. Quem importa a raiz
num Worker arrisca puxar `node:fs` junto; os subcaminhos tiram o risco da mesa
em vez de depender de *tree shaking*.

## `LogStore`

```ts
const store = clickHouseLogStore(config)
await store.insert(rows, { deduplicationToken: batchId })
```

- `async_insert=1` com **`wait_for_async_insert=1`**: o agrupamento sem perder
  a garantia de que gravou. Dentro do `waitUntil` da ingestão a espera não
  custa latência ao cliente, e sem ela uma falha viraria silêncio.
- `insert_deduplication_token` com o `batchId` — é o que torna o reenvio da
  contingência (1.11) seguro. O mesmo lote duas vezes grava uma vez só, e isso
  tem teste contra o servidor de verdade.
- **`input_format_skip_unknown_fields=0`**. Sem isso o ClickHouse aceita uma
  linha com coluna inexistente, grava o resto com defaults e responde sucesso.
  Descobri isso testando contra o servidor, não lendo documentação.
- Nome de banco e de tabela passam por `assertIdentifier` antes de entrar no
  SQL. Eles não vêm do usuário, mas valor em SQL é sempre parametrizado neste
  repositório, e identificador não dá para parametrizar — então vai validado.

## Comandos

```bash
pnpm ch:status            # o que está aplicado, pendente ou divergente
pnpm ch:migrate           # aplica as pendentes, em ordem
pnpm ch:new add_issue_id  # cria o próximo arquivo a partir de um modelo
```

Os três leem as variáveis do ambiente; se existir um `.env` na raiz do
repositório, ele é carregado antes. O CLI roda direto em `.ts` — o Node 24
remove os tipos sozinho, então o pacote não tem build.

| Variável | Para quê |
|---|---|
| `CLICKHOUSE_URL` | `http://localhost:8123` no dev |
| `CLICKHOUSE_DB` | `nekolog_dev`, `nekolog_qa` ou `nekolog_prod` |
| `CLICKHOUSE_MIGRATOR_USER`, `CLICKHOUSE_MIGRATOR_PASSWORD` | credencial com DDL |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | só quando o ClickHouse está atrás do Cloudflare Access |

O usuário de migrations é separado dos de leitura, ingestão e jobs de
propósito: é o único que pode alterar o esquema, e na nuvem ele existe só nos
*secrets* do CI.

## Como um arquivo de migration tem que ser

`migrations/NNNN_nome_em_snake_case.sql`, numerado a partir de `0001`, sem
pular nem repetir número. O runner recusa o conjunto inteiro se houver buraco
— um buraco quase sempre é um arquivo perdido num merge, não uma intenção.

**Um comando SQL por arquivo.** A API HTTP do ClickHouse executa um comando por
requisição. O runner conta os comandos (ignorando comentários e literais) e
recusa o arquivo se houver mais de um. É por isso que a tabela de rollup e a
*materialized view* que a alimenta estão em arquivos separados.

`{{database}}` é trocado pelo banco do ambiente na hora de executar. Toda
tabela é qualificada assim; nenhum arquivo cita `nekolog_dev` direto, e um
teste garante isso.

## Proteções

O controle fica em `_migrations (version, name, checksum, applied_at)`, dentro
do próprio banco do ambiente.

- **Checksum:** SHA-256 do conteúdo do arquivo **antes** da substituição de
  `{{database}}`, com `\r\n` normalizado para `\n` — assim o mesmo arquivo dá o
  mesmo checksum no Windows e no Linux. Se uma migration já aplicada for
  editada, o runner para e não aplica nada.
- **Só para frente:** não existe "down". Desfazer é uma migration nova.
- **Nada fora de ordem:** se uma migration antiga estiver pendente e uma mais
  nova já tiver sido aplicada, o runner para.
- **Nada some:** se o banco lembra de uma migration que não existe mais em
  `migrations/`, o runner para em vez de seguir como se nada fosse.
- **O banco não é criado sozinho:** se `CLICKHOUSE_DB` não existir, o runner
  diz isso e para. Criar o banco é provisionamento, não migration.
- **`CLICKHOUSE_DB` é validado** contra `[A-Za-z_][A-Za-z0-9_]*` antes de
  entrar em qualquer SQL.

Não há lock: o ClickHouse não tem um. Por isso o `ch:migrate` só roda no job de
deploy do CI, com um grupo de `concurrency` por ambiente.

## Testes

```bash
pnpm --filter @internal/clickhouse test
```

Os testes de `runner.integration.test.ts` rodam contra um ClickHouse **de
verdade** — nada de banco falso, conforme a filosofia de testes do projeto.
Eles criam um banco próprio (`nekolog_test_<pid>`), aplicam todas as
migrations, inserem um log e conferem que a *materialized view* foi alimentada,
e apagam o banco no fim.

Sem um ClickHouse acessível eles são pulados, com um aviso no stderr — suba a
stack com `pnpm dev:infra`. No CI isso seria perigoso (um teste que nunca roda
passa sempre), então o workflow define `CLICKHOUSE_TEST_REQUIRED=1`, e aí a
ausência do ClickHouse vira erro em vez de skip.

Endereço e credenciais vêm de `CLICKHOUSE_TEST_URL`, `CLICKHOUSE_TEST_USER` e
`CLICKHOUSE_TEST_PASSWORD`, com o padrão apontando para a stack local.

## O que ainda não está aqui

A etapa 1.2 entrega o esquema e o runner. O construtor de queries e o parser da
linguagem de busca (especificação 4) vêm depois, neste mesmo pacote.

A `logs_per_minute` ficou **sem TTL** de propósito: os gráficos olham mais para
trás do que a retenção do log cru permite, e o plano não fixa esse prazo. Fica
como decisão em aberto, não como esquecimento.

## Os dois rollups, e por que não é um só

| Tabela | Agrupa por | Responde |
|---|---|---|
| `logs_per_minute` | `timestamp` | "quando isso aconteceu" — gráficos |
| `usage_per_minute` | `received_at` | "quanto nos custou hoje" — cota e uso |

O `timestamp` é escolhido por quem envia. Para um gráfico isso é o certo: a
pessoa quer ver a hora do evento na aplicação dela, inclusive quando o relógio
do cliente está torto. Para cota é o errado, e de um jeito explorável — bastaria
datar os eventos de ontem para nunca aparecer na contagem de hoje. O
`received_at` é carimbado pelo servidor e não aceita opinião.

A `usage_per_minute` também não guarda `level` nem `service`: contar uso não
precisa do recorte, e sem ele a tabela fica pequena. Ela tem TTL de 90 dias,
porque uso antigo não serve para nada depois que vira fatura.

### Isso muda os grants

Toda *materialized view* obriga o usuário que faz `INSERT` em `logs` a ter
`SELECT` nas colunas que a view lê. A `usage_per_minute_mv` lê `received_at`,
então o `nekolog_ingest` passou a precisar dela:

```sql
GRANT SELECT(project_id, environment_id, timestamp, received_at, level, service)
  ON nekolog_<ambiente>.logs
```

**O grant tem que valer antes da migration rodar.** Sem ele o `INSERT` grava em
`logs`, falha ao alimentar a view e devolve erro — a gravação pela metade
descrita na seção 7 do plano. Em dev o `deploy/clickhouse-users.dev.xml` está
montado em `users.d/` e o ClickHouse recarrega o arquivo sozinho, sem restart;
em qualquer outro lugar a ordem é responsabilidade de quem faz o deploy.
