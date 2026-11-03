# @nekolog-io/db

O Postgres do NekoLog: quem são as pessoas, as organizações, os projetos, os
ambientes e as keys, mais o audit log. Drizzle para o schema, migrations em SQL
geradas pelo `drizzle-kit`.

```
users           organizations   memberships   invites
projects        environments    api_keys      audit_log
```

É a [seção 7 do plano](../../docs/PLANO.md#7-modelo-de-dados) na parte do
Postgres. O que é investigação (`issues`, `saved_views`, `releases`) e alertas
(`alert_rules`, `alert_channels`, `alert_events`) entra nos marcos M4 e M5, com
quem for usá-los.

## As regras ficam no banco, não só no código

O schema carrega **check constraints** de propósito, em vez de confiar que toda
escrita passe pelo mesmo caminho de aplicação. Dois repositórios escrevem neste
banco — este e o do dashboard — e um deles pode ganhar um caminho novo amanhã.
Constraint é a única regra que vale para os dois sem combinação.

| A regra | Por quê |
|---|---|
| todo `id` tem o prefixo da sua tabela e 26 caracteres Crockford | um `prj_…` no lugar de um `env_…` deixa de ser um bug silencioso |
| `email = lower(email)` | sem isso, `Ada@` e `ada@` viram duas contas e o índice único não ajuda |
| `hash ~ '^[0-9a-f]{64}$'` em `api_keys` | o dia em que alguém gravar a key em vez do hash, o banco recusa |
| key pública só com `logs:write` | é o que separa as duas espécies de key ([seção 6](../../docs/PLANO.md#6-projetos-ambientes-e-keys)) |
| convite nunca com papel `owner` | propriedade se transfere, não se convida |
| `country` com duas letras maiúsculas, ou nulo | o audit log nunca guarda endereço, só país |
| `retention_days >= 1` | retenção zero apagaria o log no mesmo instante |

E o que o apagar leva junto é decisão, não acidente: apagar uma organização
leva projetos, ambientes e keys em cascata, mas apagar um **usuário** só anula o
`actor_user_id` do audit log — a entrada fica. Auditoria que some quando o autor
sai não é auditoria.

## Os tipos saem do fonte, e isso é de propósito

Este é o único pacote publicado aqui que **não** gera `.d.ts`. O
`publishConfig.types` aponta para `./src/index.ts`, e o fonte vai no tarball.

O motivo é o mesmo que vale para todo o repositório: desde o TypeScript 7 as
declarações são emitidas pelo Oxc, que exige `isolatedDeclarations` — anotação
explícita em todo valor exportado. Um `pgTable(...)` devolve um
`PgTableWithColumns<…>` que ninguém escreve à mão, e manter essa anotação por
coluna, em oito tabelas, seria pior que o problema.

Isso impõe uma regra ao `src/index.ts`: **ele não importa nenhum arquivo
vizinho**. Quem consome compila esse fonte com as próprias opções, e um
`import './tables.ts'` dependeria do `allowImportingTsExtensions` do outro lado.
O `packaging.test.ts` falha se um import relativo aparecer aqui.

## Migrations

```bash
pnpm db:generate    # schema mudou → gera o SQL
pnpm db:migrate     # aplica no DATABASE_URL
```

O `drizzle-kit` compara o schema com o snapshot em `migrations/meta/` e escreve
só a diferença. As migrations vão no pacote publicado, então quem roda o
dashboard aplica as mesmas que o `apps/jobs` espera.

## Testes

`src/schema.integration.test.ts` **aplica o SQL que o pacote publica** num
database descartável (`nekolog_test_<pid>`) e tenta violar cada regra acima,
cada caso dentro de uma transação que é desfeita no fim. Ele testa o arquivo
`.sql`, não o schema do Drizzle — é o arquivo que roda em produção.

Sem um Postgres acessível os testes são pulados, com aviso no stderr. No CI,
`POSTGRES_TEST_REQUIRED=1` transforma o skip em erro.

```bash
pnpm dev:infra
pnpm --filter @nekolog-io/db test
```

## Uma branch do Neon por ambiente

Na nuvem, `dev`, `qa` e `prod` são três **branches do mesmo projeto Neon**, não
três projetos: o plano de graça conta projetos, e branch sai de graça. Cada
ambiente do GitHub guarda o `DATABASE_URL` da sua branch, e o deploy aplica as
migrations antes de publicar os Workers.

Isso ainda não está em OpenTofu — não há conta Neon, e a
[seção 15.5 do plano](../../docs/PLANO.md) deixa Neon e Upstash para quando
houver o que configurar.
