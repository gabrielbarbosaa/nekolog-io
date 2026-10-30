# Fluxo de branches e releases

> Formaliza a seção 17 do [PLANO.md](../PLANO.md) como processo operacional. Em caso de divergência, o PLANO.md é a fonte da decisão; este documento é o "como fazer" do dia a dia.

## Branches de longa duração

| Branch | Ambiente | Protegida |
|---|---|---|
| `main` | produção | sim |
| `qa` | homologação | sim |
| `dev` | desenvolvimento integrado | sim |

As três têm: sem push direto, sem force push, sem apagar a branch, CI obrigatório. `main` e `qa` também exigem commits assinados.

## Branches de trabalho

Uma etapa do [ETAPAS.md](../ETAPAS.md) = uma branch a partir da `dev`, com um dos prefixos:

`feat/`, `fix/`, `chore/`, `docs/`, `ci/`, `test/`, `security/`, `infra/`, `a11y/`

PR para a `dev`, squash merge, CI verde.

## Promoção entre ambientes

1. **`dev` → `qa`**: PR da `dev` para a `qa`, com **merge commit** (sem squash, pra não divergir). Dispara o e2e completo e a varredura do ZAP em `qa`.
2. **`qa` → `main`** (release): PR da `qa` para a `main`, também com merge commit. Na `main`, o Changesets abre o PR "Version Packages" (branch `changeset-release/main`); ao mergear esse PR, publica no npm, cria as tags e faz o deploy de produção.
3. **Sincronização**: depois de toda release, mescla a `main` de volta na `qa` e na `dev`, pra manter os números de versão alinhados.
4. **Hotfix**: branch `hotfix/…` a partir da `main`, PR direto pra `main`, depois a mesma sincronização de volta pra `qa` e `dev`.

## Quem pode abrir PR pra onde

O workflow [`branch-rules.yml`](../../.github/workflows/branch-rules.yml) é um check obrigatório que barra combinações fora do fluxo:

- PR com base `qa` só é aceito se vier de `dev` (promoção) ou de `main` (sincronização pós-release, passo 3 acima).
- PR com base `main` só é aceito se vier de `qa`, de `hotfix/*`, ou for o PR do Changesets (`changeset-release/main`).
- PRs com outra base (normalmente `dev`) não têm restrição de origem.

Isso existe porque o GitHub não tem uma regra nativa de "só aceitar PR vindo da branch X" — o ruleset trata isso como mais um status check obrigatório.

## Rulesets configurados no GitHub

Configurados em Settings → Rules → Rulesets, um por branch (`main`, `qa`, `dev`):

- Restrict deletions
- Block force pushes
- Require a pull request before merging
- Require status checks to pass (CI, e o check de `branch-rules.yml` em `qa`/`main`)
- Require signed commits (só em `main` e `qa`)

Revisão obrigatória de PR só entra quando houver um segundo mantenedor (o GitHub não deixa aprovar o próprio PR); nesse momento, o `CODEOWNERS` passa a ser respeitado pelo ruleset.

## Assinatura de commits

Commits são assinados com **chave SSH** (`gpg.format=ssh`, `commit.gpgsign=true`),
registrada no GitHub como *Signing Key*. `main` e `qa` recusam commit não
assinado.

### Exceção histórica

A assinatura só foi configurada em **30/10/2026**, no meio do M0 — o item
correspondente do [ETAPAS.md](../ETAPAS.md) tinha sido pulado. Três commits
anteriores a essa data não estão assinados e **continuam no histórico**:

| Commit | Etapa |
|---|---|
| `d1225ab` | 0.3 — pnpm workspaces, Turborepo, tsconfig, Biome |
| `f0be04e` | 0.5 — workflow de CI |
| `6530e83` | 0.4 — commitlint, lefthook, templates |

Eles entraram pelas PRs #1–#3, mergeadas com *merge commit* (que preserva os
commits originais). Da PR #4 em diante o merge foi por *squash*, e o GitHub
passou a criar um commit novo já assinado.

Para promover o M0, a regra `required_signatures` de `qa` e `main` foi
**suspensa durante o merge e restaurada em seguida**. Optou-se por isso em vez
de reescrever o histórico: `d1225ab` é o commit #2 de 19, então assiná-lo
retroativamente mudaria o SHA de praticamente toda a `dev` e quebraria a
referência das PRs já mergeadas — risco alto para benefício baixo num
repositório de um mantenedor só.

**Isso não deve se repetir.** Todo commit a partir de 30/10/2026 nasce assinado;
se uma promoção futura for bloqueada por assinatura, trate como bug, não como
caso para repetir a exceção.
