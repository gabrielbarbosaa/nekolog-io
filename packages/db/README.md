# @nekolog-io/db

O Postgres do NekoLog: quem são as pessoas, as organizações, os projetos, os
ambientes e as keys, mais o audit log. Drizzle para o schema, migrations em SQL
geradas pelo `drizzle-kit`.

```
users           organizations   memberships   invites
projects        environments    api_keys      audit_log
email_suppressions
saved_views     dashboards      releases      exports     export_schedules
```

É a [seção 7 do plano](../../docs/PLANO.md#7-modelo-de-dados) na parte do
Postgres. A segunda linha é a etapa 4.15: as tabelas do M4. Elas moram aqui
mesmo quando só o dashboard lê, porque os jobs e o dashboard escrevem neste banco
e esquema duplicado é a única divergência que teste nenhum dos dois lados pega.

Duas que **não** estão aqui, e isso é escolha: `issues` entra com a 4.6, junto
do job que as monta, e os alertas (`alert_rules`, `alert_channels`,
`alert_events`) entram no M5. Tabela cujo escritor ainda não existe é tabela
desenhada no escuro.

## As regras ficam no banco, não só no código

O schema carrega **check constraints** de propósito, em vez de confiar que toda
escrita passe pelo mesmo caminho de aplicação. Dois programas escrevem neste
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
| exportação `ready` só com `object_key`, `failed` só com `failure` | estado que mente é pior que estado faltando |
| `object_key ~ '^exports/…'` e sem `..` | o download é autenticado, mas a chave vem de dados; um `exports/../sourcemaps/` entregaria outro bucket |
| widget em lista, no máximo 50 | e o teto é escrito como `jsonb_typeof(…) <> 'array' or …`, senão o `jsonb_array_length` **levanta erro** num objeto antes de a constraint nomeada disparar, e a mensagem some |

## Um ambiente nunca é emprestado de outro projeto

Toda tabela do M4 que carrega `project_id` **e** `environment_id` tem uma chave
estrangeira **composta** para `environments (id, project_id)` — e não duas
chaves separadas. Com duas separadas, nada impede uma linha do projeto A apontar
para um ambiente do projeto B: as duas são válidas isoladamente. É vazamento
entre inquilinos escrito no esquema, e o tipo de coisa que só aparece depois.

É por isso que existe o índice `environments_id_and_project`: o Postgres exige
unicidade nas colunas referenciadas. Ele nasce na migration **0002** e as
tabelas na **0003**, nessa ordem, porque uma chave estrangeira criada antes do
índice é recusada na hora de aplicar. Duas migrations em vez de uma é o preço de
não editar SQL gerado à mão.

Com `environment_id` nulo (uma view salva que vale para o projeto inteiro) a
chave composta não exige nada, que é o comportamento certo.

## Uma regra que **não** está no esquema

O plano limita a instância hospedada a uma exportação agendada por dia por
projeto, por causa da cota de e-mail. Isso **não** virou constraint: é regra da
instância hospedada, e quem roda self-host não tem cota de e-mail do Resend para
respeitar. O esquema só garante o que vale nos dois: uma agenda viva por cadência
por ambiente.

E o que o apagar leva junto é decisão, não acidente: apagar uma organização
leva projetos, ambientes e keys em cascata, mas apagar um **usuário** só anula o
`actor_user_id` do audit log — a entrada fica. Auditoria que some quando o autor
sai não é auditoria.

## Não vai ao npm

Este pacote é `private: true` e nunca é publicado — ADR
[0019](../../docs/adr/0019-um-repositorio-so.md). A ADR
[0016](../../docs/adr/0016-pacotes-compartilhados-no-npm.md) o tinha feito
nascer publicado porque o dashboard vivia noutro repositório e escrevia no mesmo
Postgres. O dashboard veio para cá, e publicar este pacote sempre foi o caso mais
grave dos quatro: ele publicava o `src/index.ts` **como os tipos**, ou seja, o
esquema inteiro do banco em TypeScript legível no npm público.

O motivo de não gerar `.d.ts` continua existindo e vale para quem for mexer
aqui: desde o TypeScript 7 as declarações são emitidas pelo Oxc, que exige
`isolatedDeclarations` — anotação explícita em todo valor exportado. Um
`pgTable(...)` devolve um `PgTableWithColumns<…>` que ninguém escreve à mão, e
manter essa anotação por coluna, em oito tabelas, seria pior que o problema. O
`exports` aponta para `./src/index.ts` e quem consome é este mesmo workspace.

A regra que disso saía — **o `src/index.ts` não importa nenhum arquivo
vizinho** — deixou de valer: ela existia porque um consumidor de fora compilava
esse fonte com as próprias opções, e um `import './tables.ts'` dependeria do
`allowImportingTsExtensions` do outro lado. Não há mais consumidor de fora. O
arquivo continua como está porque não há motivo para mexer, mas nada mais o
obriga.

## Migrations

```bash
pnpm db:generate    # schema mudou → gera o SQL
pnpm db:migrate     # aplica no DATABASE_URL
```

O `migrations/meta/_journal.json` é JSON e **não pode ter BOM**. Ele tinha um,
vindo de uma escrita de PowerShell, e o `pnpm db:generate` morria em
`Unexpected token '﻿'` sem que nada no CI notasse — o teste de deriva copia a
pasta e o `drizzle-kit` engolia a cópia. Se você editar um arquivo desta pasta
no Windows, confira os três primeiros bytes.

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

## Issues

```
issues                  issue_environments
```

É a etapa 4.6 e a [especificação 5](../../docs/ESPECIFICACOES.md): **uma issue é
a combinação de projeto e fingerprint, com contagem por ambiente**. Por isso são
duas tabelas: a `issues` guarda o estado que uma pessoa mexe (status,
responsável, quando foi resolvida) e a `issue_environments` guarda a contagem,
que é por ambiente.

O `fingerprint` é **texto**, não número. Ele nasce como `UInt64` no ClickHouse,
e `18446744073709551615` não cabe num `number` do JavaScript — guardar como
`bigint` no Postgres só moveria o problema para o driver. A constraint exige de
1 a 20 dígitos e recusa `0`, que é o valor que significa "sem fingerprint" e
nunca deveria virar issue.

As três regras que o `sqlIssueStore` do `@nekolog-io/adapters` escreve no
`on conflict`, e que esta tabela torna possíveis:

- `first_seen_at` nunca anda para frente e `last_seen_at` nunca anda para trás
  (`least` e `greatest`), porque um lote atrasado chega fora de ordem;
- uma issue **resolvida** que acontece de novo volta para `open` e ganha
  `regressed_at` — mas só se a ocorrência for mais nova que a correção, senão um
  lote de antes do deploy desfaria o conserto;
- uma issue **ignorada** nunca volta. Ignorar é isso.

`issues_resolved_means_there_is_a_moment` existe porque uma issue resolvida sem
`resolved_at` deixaria a segunda regra sem referência: o `on conflict` compararia
com `null` e nunca reabriria nada.
