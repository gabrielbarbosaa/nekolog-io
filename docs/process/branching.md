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

- PR com base `qa` só é aceito se vier de `dev`.
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
