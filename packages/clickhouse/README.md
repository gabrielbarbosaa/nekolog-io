# @nekolog-io/clickhouse

Esquema do ClickHouse do NekoLog e o runner que o aplica. Implementa a
[especificação 3](../../docs/ESPECIFICACOES.md#3-runner-de-migrations-do-clickhouse)
e cria as tabelas da [seção 7 do plano](../../docs/PLANO.md#7-modelo-de-dados).

Pacote interno: não vai para o npm.

## Pontos de entrada

| Import | O que traz | Roda em |
|---|---|---|
| `@nekolog-io/clickhouse` | tudo, inclusive o runner | Node |
| `@nekolog-io/clickhouse/client` | só o cliente HTTP | qualquer runtime |
| `@nekolog-io/clickhouse/log-store` | o `LogStore` da ingestão | qualquer runtime |

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
pnpm --filter @nekolog-io/clickhouse test
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

## A linguagem de busca

```ts
import { searchWhere } from '@nekolog-io/clickhouse/search'

const { sql, params } = searchWhere('level:error -service:web "timed out"', {
  projectId,
  environmentIds,
  from,
  to,
}, { environments: { production: 'env_...', staging: 'env_...' } })

const rows = await queryRows(config, `SELECT * FROM logs WHERE ${sql} LIMIT 100`, { params })
```

É a [especificação 4](../../docs/ESPECIFICACOES.md): léxico, gramática, campos
aceitos e a tradução para SQL. O parser mora aqui e não no dashboard porque os
dois repositórios precisam da mesma linguagem, e uma segunda implementação da
mesma gramática diverge no primeiro caso de canto.

| Entrada | SQL |
|---|---|
| `level:error` | `level = {p1:String}` |
| `service:api-*` | `startsWith(service, {p1:String})` |
| `level:(error OR fatal)` | `level IN ({p1:String}, {p2:String})` |
| `@orderId:123` | `attributes[{p1:String}] = {p2:String}` |
| `@status>=500` | `toFloat64OrNull(attributes[{p1:String}]) >= {p2:Float64}` |
| `timeout` | `hasToken(lower(message), {p1:String})` |
| `"payment failed"` | `positionCaseInsensitive(message, {p1:String}) > 0` |

### Nada do que a pessoa digita vira SQL

Todo valor é **parâmetro**, inclusive o **nome do atributo**: o `@orderId` vira
`attributes[{p1:String}]`, não `attributes['orderId']`. Interpolar a chave seria
o único ponto de injeção da tradução inteira, e um `@a'] OR 1=1 --:x` fecha o
colchete. O nome ainda é conferido contra a forma que a especificação 1 garante
(`[A-Za-z0-9_.-]`), mas isso é cinto **e** suspensório: o parâmetro é quem
protege.

Campo que não existe é erro **com a posição no texto**, nunca um nome de coluna
vindo de fora. O teste de fuzzing apaga os parâmetros do SQL gerado e exige que o
esqueleto não tenha aspas, barra invertida, ponto e vírgula nem `--`.

### O escopo é do servidor, e vem antes

O `searchWhere` não devolve o filtro da pessoa sozinho: ele monta

```
project_id = {s_project:String} AND environment_id IN (...) AND
timestamp >= {s_from:...} AND timestamp < {s_to:...} AND (<o que a pessoa escreveu>)
```

O filtro da pessoa vai **sempre entre parênteses**, mesmo quando é uma condição
só, para nenhuma precedência alcançar o `AND` de fora. Os parâmetros do escopo
usam o prefixo `s_` e os da busca são sempre `p<n>`, então uma busca não
consegue nomear um parâmetro do escopo — e, se conseguisse, o `searchWhere`
recusa antes de montar. Lista de ambientes vazia e período invertido também são
recusa, não consulta: escopo que não escopa é bug, não filtro.

### Duas decisões que parecem detalhe

**`env:` é nome na entrada e id na saída.** O chamador passa o mapa
`nome → environment_id`; sem o mapa, um `env:` é **erro**, porque comparar o
nome com a coluna de id devolveria zero linhas em silêncio. Já um nome que não
existe no mapa vira `0` — não casa com nada —, porque um prefixo pode
legitimamente não casar e um favorito antigo não deveria virar erro.

**Palavra vai por `hasToken`, o resto vai por substring.** O `hasToken` usa o
índice de tokens sobre `lower(message)`, mas ele **levanta exceção** se a agulha
tiver um separador. Então só uma palavra de `[A-Za-z0-9_]` vai por ali; qualquer
outra coisa (e toda frase entre aspas) vai por `positionCaseInsensitive`. Tem
teste de integração com `api.timeout` exatamente por isso.

### Testes

`parse.test.ts` e `compile.test.ts` são unitários; `search.fuzz.test.ts` joga
texto hostil e montado contra o parser e exige que nada além de `SearchError`
saia, que o esqueleto do SQL continue limpo e que o escopo não saia do lugar
(com o bloco `the fuzzer itself` conferindo que as duas saídas acontecem, para a
propriedade não passar por vacuidade); e `search.integration.test.ts` roda o SQL
gerado contra um **ClickHouse de verdade**, que é o único lugar onde se descobre
que `attributes[{p:String}]` funciona e que o `hasToken` não aceita um ponto.
