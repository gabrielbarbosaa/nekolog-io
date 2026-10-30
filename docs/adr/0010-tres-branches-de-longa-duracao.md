# ADR 0010 — Três branches de longa duração

- **Status:** aceita
- **Data:** 2026-10-29
- **Plano:** seções 1 e 17

## Contexto

O projeto tem três ambientes reais (`dev`, `qa`, `prod`), cada um com seu
dashboard, sua ingestão, seu banco e suas cotas. Era preciso um fluxo de branch
que mapeasse para eles sem ambiguidade, e que permitisse testar uma promoção
inteira antes de ela chegar em produção.

## Decisão

Três branches protegidas, uma por ambiente:

| Branch | Ambiente | Dashboard | npm |
|---|---|---|---|
| `dev` | desenvolvimento | `dev.nekolog.io` | snapshot sob demanda |
| `qa` | homologação | `qa.nekolog.io` | snapshot a cada promoção |
| `main` | produção | `app.nekolog.io` | versão estável |

Cada etapa do ETAPAS.md vira uma branch a partir da `dev`, com prefixo por tipo
(`feat/`, `fix/`, `chore/`, `ci/`, `docs/`, `test/`, `security/`, `infra/`,
`a11y/`), e um PR.

**PR para `dev` usa squash** (uma etapa = um commit). **Promoções usam merge
commit**, não squash — senão as branches divergem e cada promoção vira um
conflito.

Hotfix sai da `main`, volta para a `main`, e depois é sincronizado de volta para
`qa` e `dev`.

## Consequências

- **O tipo de merge não é preferência, é requisito.** Squash numa promoção
  reescreve os commits, e a `qa` passa a divergir da `dev` permanentemente.
  Quem mergear precisa saber disso — está documentado em
  [docs/process/branching.md](../process/branching.md).
- **O GitHub não tem regra nativa de "PR só pode vir da branch X".** Foi
  preciso um workflow próprio (`.github/workflows/branch-rules.yml`) que recusa
  PR para `qa` que não venha da `dev`, e para `main` que não venha de `qa`,
  `hotfix/*` ou do PR do Changesets. Ele é um status check obrigatório.
- **Rulesets no GitHub, sem bypass para ninguém** — nem para o dono do
  repositório. Sem push direto, sem force push, sem apagar branch, CI
  obrigatório; `main` e `qa` também exigem commit assinado.
- **Sincronização pós-release é um passo manual fácil de esquecer.** Se a `main`
  não voltar para `qa` e `dev`, as versões divergem silenciosamente.
- **Revisão obrigatória fica para depois.** Com uma pessoa só, o GitHub não
  permite aprovar o próprio PR. Quando entrar mais alguém, passa a exigir uma
  aprovação e o `CODEOWNERS` começa a valer.
- **Mais cerimônia que trunk-based.** Para um time de uma pessoa é overhead
  real; aceito porque os três ambientes precisam existir de qualquer forma.

## Alternativas consideradas

- **Trunk-based com feature flags.** Menos cerimônia e menos merge.
  Descartado: exige infraestrutura de flags e disciplina de deploy contínuo que
  não existem aqui, e não dá um lugar natural para "homologação" com ZAP e e2e
  completo rodando antes de produção.
- **GitFlow completo** (com `release/*` e `develop`). Descartado por excesso:
  branches de release não agregam quando o Changesets já cuida de versionar.
- **Duas branches (`main` e `dev`).** Mais simples. Descartado porque elimina o
  ambiente de homologação, que é onde a varredura do ZAP e o e2e completo rodam
  antes de produção.
