# ADR 0012 — Escolha de bibliotecas: ECharts, Valibot, runner próprio

- **Status:** aceita
- **Data:** 2026-10-29
- **Plano:** seções 1, 10 e 15.2; especificação 3

## Contexto

Quatro escolhas de biblioteca têm consequência arquitetural suficiente para
merecer registro — as demais (Tailwind, shadcn/ui, Drizzle, TanStack) são
convencionais e seguem o padrão do ecossistema.

O que amarra as quatro é a mesma restrição: **tamanho e custo**. O Worker de
ingestão tem ~10 ms de CPU e um limite de bundle; o SDK de browser tem meta de
menos de 5 KB gzip; e tudo precisa caber em plano gratuito
(ADR [0003](0003-so-servicos-gratuitos.md)).

## Decisão

**Gráficos: ECharts**, com importação modular (`echarts/core`) e tema gerado em
tempo de execução a partir dos tokens CSS (`--chart-*`, `--level-*`), trocado
junto com claro/escuro. Modo `aria` e texturas (decal) ligados.

**Validação: Valibot**, no SDK e na ingestão.

**Migrations do ClickHouse: runner próprio** em TypeScript (especificação 3),
com um comando SQL por arquivo, controle em tabela `_migrations`, checksum e
só-para-frente.

**Monitor externo: Better Stack**, no plano gratuito, checando `/health` de
ingest, web e jobs, e recebendo heartbeat dos jobs.

## Consequências

- **ECharts é pesado se importado inteiro.** A importação modular é obrigatória,
  não otimização — e isso é fácil de quebrar sem perceber num import
  descuidado.
- **O tema dos gráficos tem que ser gerado em runtime**, lendo as variáveis CSS,
  porque os tokens vivem no CSS (tema Grafite) e precisam acompanhar a troca de
  claro/escuro. Um tema estático duplicaria as cores em dois lugares.
- **Valibot é menos conhecido que Zod.** Menos exemplos, menos respostas
  prontas, ecossistema de integração menor. Pagou-se isso pelo bundle: a API
  modular do Valibot permite importar só o que se usa, o que importa no Worker e
  no SDK.
- **O runner de migrations é código próprio para manter e testar.** Em troca
  resolve uma limitação concreta: a API HTTP do ClickHouse executa um comando
  por request, então o arquivo precisa ter um comando só — e nenhuma ferramenta
  pronta assume isso.
- **Sem "down migration".** Desfazer é uma migration nova. Simplifica o runner e
  evita a ilusão de que um rollback de schema é seguro em banco analítico.
- **O ClickHouse não tem lock de migration.** O runner só roda no job de deploy
  do CI, com `concurrency` do GitHub Actions por ambiente. Rodar duas vezes em
  paralelo corromperia o controle.
- **O NekoLog não pode se monitorar sozinho.** Daí um monitor externo: se a
  plataforma cair, ela não consegue avisar que caiu.

## Alternativas consideradas

- **Recharts ou Chart.js** em vez de ECharts. Mais simples de usar e mais
  integrados ao React. Descartados por desempenho com muitos pontos — um
  Explorer de logs plota séries longas, e é aí que os dois degradam.
- **Zod** em vez de Valibot. Ecossistema muito maior e mais familiar.
  Descartado pelo tamanho no bundle do Worker e do SDK de browser.
- **`clickhouse-migrations` ou ferramenta genérica (Flyway, dbmate).**
  Descartadas por não lidarem bem com a restrição de um comando por request da
  API HTTP, e por adicionarem uma dependência (ou um runtime não-JS, no caso do
  Flyway) para um problema pequeno.
- **Drizzle Kit também para o ClickHouse.** Não suporta ClickHouse; o Drizzle
  fica só no Postgres.
- **UptimeRobot ou Healthchecks.io** em vez de Better Stack. Equivalentes no
  plano gratuito; o Better Stack foi escolhido por já trazer página de status
  pública junto, que serve ao objetivo de portfólio.
