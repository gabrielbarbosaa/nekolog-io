# @internal/clickhouse

Esquema do ClickHouse do NekoLog e o runner que o aplica. Implementa a
[especificação 3](../../docs/ESPECIFICACOES.md#3-runner-de-migrations-do-clickhouse)
e cria as tabelas da [seção 7 do plano](../../docs/PLANO.md#7-modelo-de-dados).

Pacote interno: não vai para o npm.

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
