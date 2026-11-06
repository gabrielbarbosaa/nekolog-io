# ADR 0019 — Um repositório só, e os pacotes de servidor saem do npm

- **Status:** aceita
- **Data:** 2026-11-06
- **Substitui:** [0016](0016-pacotes-compartilhados-no-npm.md)
- **Relacionada:** [0017](0017-licenca-proprietaria-e-repositorio-privado.md), [0002](0002-open-core-com-dashboard-fechado.md)
- **Plano:** seções 1, 2, 10, 18 e 20

## Contexto

A [0002](0002-open-core-com-dashboard-fechado.md) separou o projeto em dois
repositórios por um motivo só: este era **público sob MIT** e o dashboard não
podia ser. A [0016](0016-pacotes-compartilhados-no-npm.md) então publicou
`adapters`, `clickhouse`, `config` e `db` no npm público, porque o dashboard,
estando noutro repositório, precisava instalá-los — e um registro privado
"adicionaria tokens de autenticação para proteger nada".

A [0017](0017-licenca-proprietaria-e-repositorio-privado.md) tornou este
repositório privado e proprietário. Ela removeu o motivo da divisão e registrou
a consequência como pergunta aberta: *"a distribuição dos quatro pacotes
compartilhados vira pergunta aberta. A 0016 os publicou no npm público porque o
dashboard precisa instalá-los; publicá-los agora é entregar o esquema do
Postgres e as implementações de servidor."*

Em 06/11/2026 essa pergunta parou de ser teórica: começar o dashboard exige dar
o primeiro `pnpm install`, e ele não resolve sem esses quatro.

Três fatos pesaram, e todos foram conferidos antes de decidir:

1. **O `nekolog-dashboard` está vazio** — criado em 30/10, zero commits, sem
   branch padrão. Não há nada para desfazer.
2. **Nada foi publicado no npm.** `@nekolog-io/core` responde 404, e a variável
   `NPM_PUBLISH_ENABLED` que libera a publicação não existe.
3. **Nenhum SDK publicado depende dos quatro.** Só o `clickhouse` depende do
   `adapters` e do `config`, e os três são do mesmo grupo. A restrição que
   obrigou o `config` a ser publicado — pacote publicado não pode depender de
   pacote privado — desaparece quando os quatro viram privados juntos.

## Decisão

- **Um repositório.** O dashboard vem para cá como `apps/dashboard`. O
  `nekolog-dashboard` não recebe código.
- **`adapters`, `clickhouse`, `config` e `db` são `private: true`** e nunca vão
  ao npm. Perdem `publishConfig`, `files`, o `build` do tsdown e o `lint` que
  empacotava um tarball para `publint` e `attw` — tudo isso existia só para
  publicar.
- **Ao npm vão treze pacotes:** os doze SDKs e o `@nekolog-io/core`. É
  exatamente o que a landing page já afirma — "12 SDKs sobre um núcleo só".
- **O cliente continua recebendo duas coisas**, como a 0017 diz: a lib, de um
  registro público, e um login no dashboard hospedado. Isso não muda.

## Alternativas descartadas

- **Registro privado (GitHub Packages).** Mantém a divisão e protege o esquema,
  ao custo de um token no CI dos dois repositórios e no `.npmrc` de cada
  máquina, e de uma release a cada mudança compartilhada antes de o dashboard
  enxergá-la. A objeção da 0016 — "tokens para proteger nada" — deixou de valer,
  mas o atrito é real e o benefício é zero quando os dois lados são do mesmo
  dono e do mesmo time de uma pessoa.
- **Submodule ou subtree.** Sem registro e sem token, mas é o pior dos três em
  ferramenta com workspace pnpm, e o commit fixado vira uma versão implícita que
  ninguém lê.
- **Manter a divisão e publicar mesmo assim.** É o que a 0016 manda e o que a
  0017 já tinha identificado como entrega do esquema do Postgres — o `db`
  publica o `src/index.ts` como tipos, então seria o esquema inteiro em
  TypeScript legível no npm público.

## Consequências aceitas

- **A seção 2 do plano dizia "separação de produto, não de licença"** como razão
  para os dois repositórios. Era uma reafirmação da divisão, não uma razão
  independente dela, e cai junto.
- **Um CI só.** Um teste de dashboard vermelho trava o merge de um SDK. É o
  preço de um `pnpm install` só, de uma mudança compartilhada caber num PR só e
  de não existir defasagem de versão entre os dois lados.
- **O repositório fica maior**, e o `apps/dashboard` será a maior coisa dentro
  dele.
- **As 26 etapas de dashboard passam a ter checkbox aqui.** Elas estavam no
  `ETAPAS.md` sem checkbox justamente para o `internal/tracking` não abrir issue
  de trabalho que não é deste repositório; agora é.
- **O escopo `@nekolog-io/*` deixou de significar "vai ao npm".** O comando de
  SBOM filtra por ele, então os quatro privados precisam de exclusão explícita
  em `SBOM_EXCLUDED`, com teste ligando a lista ao conjunto privado.
  **Renomeá-los para `@internal/*` e movê-los para `internal/` é etapa
  própria** — são 283 ocorrências em 136 arquivos, e misturar isso com a decisão
  tornaria os dois irrevisáveis.
- **O `nekolog-dashboard` vazio continua existindo** no GitHub. Apagar
  repositório é irreversível e não é urgente.
