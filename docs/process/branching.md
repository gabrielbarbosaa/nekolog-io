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

## Como uma versão sai

O `release.yml` roda a cada push na `main` e faz uma de duas coisas, nunca as
duas: se existe changeset pendente, ele abre ou atualiza o PR "Version
Packages"; se não existe, os números já estão no repositório e ele **publica**.

Antes de qualquer uma das duas, ele constrói — cada pacote publica só o `dist`,
e publicar um `dist` vazio é um pacote quebrado no npm que não dá pra
despublicar — e escreve um SBOM CycloneDX por pacote publicado, conferindo que
o conjunto descreve exatamente esta release. Depois de publicar, anexa o
documento de cada pacote à Release daquele pacote.

| O quê | Onde |
|---|---|
| Versões e changelogs | Changesets, pelo PR "Version Packages" na `main` |
| Tags e Releases | `createGithubReleases` do `changesets/action`, uma por pacote |
| Publicação no npm | `pnpm publish`, por **trusted publishing** |
| Proveniência | automática sob trusted publishing; nada a passar |
| SBOM | `pnpm run release:sbom`, anexado a cada Release |

**Não existe token do npm.** A autenticação é um token OIDC que o GitHub emite
para aquele workflow daquele repositório (`id-token: write`), e o npm o troca
pela permissão de publicar. Um teste em `internal/release` falha se
`NPM_TOKEN`, `NODE_AUTH_TOKEN` ou um `.npmrc` aparecerem no workflow. Do outro
lado, cada pacote precisa ter o *trusted publisher* configurado no npmjs.com
apontando para este repositório e para o arquivo **`release.yml`** — só o nome
do arquivo, não o caminho.

A publicação está atrás da variável de repositório `NPM_PUBLISH_ENABLED`, que
não existe: sem ela o workflow ainda versiona, constrói e escreve o SBOM, e não
publica nada. É o mesmo arranjo do `INFRA_ENABLED`, do `WORKERS_DEPLOY_ENABLED`
e do `BACKUPS_ENABLED`.

### A saída do `0.x` foi feita uma vez, à mão

A 1.0 saiu na etapa 6.7, num PR próprio para a `dev`, e não pelo PR "Version
Packages". O motivo é que não havia release anterior: eram 67 changesets
acumulados desde o primeiro commit e nenhum pacote jamais publicado, então o
"Version Packages" seria o PR da história inteira do repositório. Da 1.0 em
diante o fluxo é o da tabela acima, sem exceção.

Essa foi também a primeira vez que `changeset version` rodou de verdade, e ele
**falhou**: desde o começo havia changesets listando um pacote publicado e um
app privado juntos, e o Changesets trata pacote privado como ignorado e recusa
um changeset misto. Ou seja, a primeira release teria quebrado no primeiro
comando. A correção é `privatePackages: { version: true, tag: false }` no
`.changeset/config.json` — que é o que a seção 16 do PLANO.md já dizia: os apps
são versionados como pacotes privados, e aparecem no `/health`.

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

### Reescrita do histórico em 30/10/2026

A assinatura só foi configurada no meio do M0 — o item correspondente do
[ETAPAS.md](../ETAPAS.md) tinha sido pulado. Três commits anteriores
(`d1225ab`, `f0be04e`, `6530e83`, das etapas 0.3, 0.5 e 0.4) ficaram sem
assinatura e entraram no histórico pelas PRs #1–#3, mergeadas com *merge
commit*, que preserva os commits originais.

Isso só apareceu na primeira promoção, e não como um contratempo pontual: como
`qa` e `main` recusam commit não assinado, **toda promoção futura com merge
commit ficaria bloqueada**. A primeira promoção do M0 chegou a ser feita com
squash para contornar, o que exigiu depois uma sincronização de volta para a
`dev` com resolução de conflito `add/add`.

Em vez de conviver com isso, o histórico foi **reescrito e reassinado**:

- Os 19 commits foram recriados com assinatura SSH e verificados pelo GitHub.
- O histórico ficou **linear** — os merge commits das PRs #1–#3 e da
  sincronização foram achatados.
- O conteúdo não mudou: a árvore resultante é idêntica à anterior.
- `dev`, `qa` e `main` foram apontadas para o mesmo commit.
- A regra `required_signatures` **não** foi tocada; o que se suspendeu durante
  os três pushes foi o bloqueio de force-push, restaurado em seguida.

**Custo aceito:** todos os SHAs mudaram, então as PRs #1–#24 referenciam commits
órfãos. Os diffs continuam visíveis no GitHub. Isso foi feito com o repositório
tendo 5 horas de vida, sem nenhuma tag ou release — o momento mais barato
possível.

**Não deve se repetir.** Todo commit nasce assinado desde então. Se uma promoção
futura for bloqueada por assinatura, é bug, não precedente para nova exceção.
