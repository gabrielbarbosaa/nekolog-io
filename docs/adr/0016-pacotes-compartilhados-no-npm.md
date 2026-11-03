# ADR 0016 — Pacotes compartilhados publicados no npm

- **Status:** aceita
- **Data:** 2026-11-03
- **Plano:** seções 2, 18 e 19
- **Relacionada:** [0002](0002-open-core-com-dashboard-fechado.md) (open-core com o dashboard fechado)

## Contexto

A decisão de separar o dashboard num repositório privado (ADR
[0002](0002-open-core-com-dashboard-fechado.md)) deixou uma pergunta em aberto —
ela está nas consequências daquele ADR e na seção 2 do plano desde 30/10/2026:
**como o `nekolog-dashboard` consome o código que vive aqui?**

Não é uma pergunta teórica. O dashboard precisa de pelo menos quatro coisas
deste repositório:

| O quê | Para quê |
|---|---|
| `internal/db` | o mesmo Postgres que o `apps/jobs` lê e grava |
| `internal/clickhouse` | o cliente, o construtor de query e o parser da busca do Explorer |
| `internal/adapters` | `KeyStore` (sincronizar key com o KV), `Mailer`, `RedisClient`, `BlobStore` |
| `internal/schema` | o formato do evento, para renderizar e para o gerador de logs falsos |

O item mais sensível é o `db`: os dois repositórios **escrevem no mesmo banco**.
Se as definições divergirem, a falha não aparece em teste nenhum dos dois lados
— aparece em produção, como coluna que não existe ou constraint violada.

O M2 não começa sem uma resposta, porque a etapa 2.2 cria justamente o
`internal/db`, e a forma dele depende disso.

## Decisão

**Publicar os quatro no npm público, sob `@nekolog-io/`, movendo-os de
`internal/` para `packages/`.**

```
packages/schema      @nekolog-io/schema
packages/adapters    @nekolog-io/adapters
packages/clickhouse  @nekolog-io/clickhouse
packages/db          @nekolog-io/db        (nasce assim, na etapa 2.2)
```

O resto de `internal/` continua interno: `config`, `spool`, `seed`, `tracking` e
`deploy` só fazem sentido dentro deste repositório.

A conversão é a etapa **2.0** do `docs/ETAPAS.md`, antes de qualquer outra do
M2.

Publicar não revela nada: este repositório é público e MIT, e qualquer pessoa já
lê esse código no GitHub hoje. O que a publicação muda é só a **forma de
consumir** — uma dependência versionada, em vez de um caminho relativo.

## Consequências

- **Uma mudança compartilhada passa por release antes de chegar no dashboard.**
  É o custo real desta escolha. Mitigado pelo que já existe: a `dev` publica
  snapshot sob a tag `dev` (`pnpm version-packages:dev`, seção 17 do plano), então
  o dashboard acompanha `@nekolog-io/db@dev` durante o desenvolvimento e fixa uma
  versão estável quando promove.
- **Os quatro passam a exigir `isolatedDeclarations: true`.** O TypeScript 7 não
  expõe mais a API clássica que o gerador de `.d.ts` do tsdown usava, então as
  declarações saem do Oxc, que exige anotação explícita em valor exportado cujo
  tipo não é inferível sintaticamente. Isso já vale para o `@nekolog-io/core`; a
  etapa 2.0 estende para os quatro.
- **Todo import `@internal/schema`, `@internal/adapters` e `@internal/clickhouse`
  vira `@nekolog-io/…`.** Mecânico e de uma vez só, na 2.0.
- **O `@nekolog-io/core` continua com zero dependências de runtime.** Ele não
  importa `@nekolog-io/schema` em produção; o `contract.test.ts` segue
  importando como dependência de desenvolvimento, que é o que impede os limites
  duplicados de divergirem.
- **O runner de migrations do ClickHouse passa a ser instalável.** Efeito
  colateral bom: quem faz self-host precisa dele e hoje só o consegue clonando o
  repositório.
- **Alguém de fora pode passar a depender desses pacotes.** O README de cada um
  diz o que eles são — peças que os dois repositórios do NekoLog compartilham,
  não uma API pública estável — mas o semver vale do mesmo jeito, e uma mudança
  incompatível vira major. É o preço de publicar em registro público.
- **O modelo de dados do Postgres fica num pacote publicado.** Ele já está num
  repositório público; não há segredo em schema. Credencial nunca esteve no
  código.

## Alternativas consideradas

- **Registro privado (GitHub Packages).** Era a primeira opção escrita na seção
  2 do plano. Descartada por não comprar nada: exigiria `NODE_AUTH_TOKEN` no CI
  do dashboard e no `.npmrc` de cada máquina **para proteger código que está
  público no GitHub**. Custo de autenticação sem benefício de confidencialidade.
- **Submódulo git deste repositório dentro do dashboard.** Descartada por peso e
  por duplicar o versionamento: o dashboard carregaria o repositório inteiro,
  o CI dele instalaria todo o grafo de dependências daqui, e "qual commit está
  fixado" viraria um segundo sistema de versão convivendo com o npm.
- **Duplicar o schema do Drizzle nos dois repositórios.** Descartada pelo mesmo
  motivo que o `packages/core/src/contract.test.ts` existe: duplicação só é
  segura quando um teste compara as cópias. Aqui as cópias ficam em
  repositórios diferentes, e nenhum teste consegue olhar as duas.
- **O dashboard acessar o Postgres com definições próprias apontando para as
  mesmas tabelas.** É a duplicação acima com outro nome, e com o agravante de
  parecer independência.
