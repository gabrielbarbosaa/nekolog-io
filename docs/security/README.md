# Segurança

Segurança é prioridade em todas as camadas: a plataforma recebe dados de
terceiros, guarda credenciais e publica pacotes que rodam dentro da aplicação de
outras pessoas (plano, seção 14).

| Documento | O que é |
|---|---|
| [threat-model.md](threat-model.md) | Modelo de ameaças STRIDE por fronteira de confiança, com o status de cada mitigação e a lista do que foi aceito sem mitigação completa. **Versão 2**, revisada na etapa 6.5. |
| [asvs.md](asvs.md) | O que deste repositório fecha do OWASP ASVS nível 2, com o ponteiro de onde cada afirmação é verificada. |
| [zap/](zap/README.md) | Como rodar o OWASP ZAP contra a ingestão e a API pública, e quais regras são tratadas de outro jeito, com o motivo. |
| [../runbooks/](../runbooks/README.md) | O que fazer quando algo dá errado: incidente, vazamento de key, rotação de segredos, restauração de backup. |
| [../../SECURITY.md](../../SECURITY.md) | Política pública de reporte de vulnerabilidade. |

## Processo

- **Modelo de ameaças revisado a cada marco.** A revisão não é opcional: cada
  marco implementa mitigações que hoje estão marcadas como "Planejada", e é na
  revisão que se confirma que elas existem e têm teste.
- **PRs sensíveis** — os que tocam autenticação, `apps/ingest` ou verificação de
  permissão — recebem o label `security` e passam por checklist próprio antes do
  merge.
- **OWASP ASVS nível 2** é o checklist de referência para autenticação, sessão,
  controle de acesso, validação de entrada e configuração. A revisão do que é
  deste repositório aconteceu na etapa 6.5 e está em [asvs.md](asvs.md).
  Autenticação, sessão e controle de acesso por papel são do dashboard e têm
  revisão dedicada própria antes da demo pública.
- **Revisão dedicada do módulo de autenticação** antes da demo pública, porque
  ele é escrito à mão (ADR [0007](../adr/0007-autenticacao-propria.md)).

## Verificações automáticas

O que já roda em todo PR:

| Verificação | O que pega |
|---|---|
| `Supply chain` → `pnpm audit` | Dependência com vulnerabilidade conhecida, em qualquer nível da árvore |
| `Supply chain` → `licences:check` | Dependência sob GPL ou AGPL, que não pode entrar num produto proprietário |
| Dependabot + Renovate | Atualização de dependência e de action |
| Secret scanning + push protection | Segredo commitado |
| Branch rulesets | Push direto, force push, commit não assinado em `main`/`qa` |

Já existem também: fuzzing do validador de payload e do parser da busca, teste
automático dos cabeçalhos de segurança nos dois sites e nas duas APIs, e o
orçamento de CPU da ingestão medido em teste. A varredura do ZAP é **manual** —
ver [zap/](zap/README.md) — porque a automática a cada promoção depende de `qa`
existir. Teste de IDOR entre organizações é do dashboard.

### O que saiu, e o que não foi substituído

Em 06/11/2026 o CodeQL, o `dependency-review` e o OpenSSF Scorecard foram
removidos. Os dois primeiros exigem GitHub Advanced Security em repositório
privado — falhavam com `Resource not accessible by integration` e
`Dependency review is not supported on this repository` em todo PR — e o
Scorecard mede repositório público. A ADR
[0017](../adr/0017-licenca-proprietaria-e-repositorio-privado.md) já previa isso
e dizia que substituí-los era etapa própria; esta é a etapa.

O `dependency-review` foi substituído com vantagem: ele olhava **só as
dependências que o PR mudava**, e `pnpm audit` mais `licences:check` olham a
árvore inteira a cada PR. A política de licenças ficou mais larga de propósito —
recusa a família GPL e AGPL em qualquer grafia, e não só as seis identificações
SPDX que a lista antiga nomeava, porque um manifesto pode escrever `GPL-3.0` ou
o nome por extenso. Expressão com escolha (`MIT OR GPL-3.0`) passa, porque a
escolha é nossa; conjunção (`MIT AND GPL-3.0`) não passa. LGPL não é recusada.

**O CodeQL não tem substituto.** Análise de taint em JS/TS não existe de graça
em repositório privado, e nenhuma regra de lint faz o que ele fazia. É a única
perda real desta troca, e está registrada aqui para não ser esquecida: ou se
paga o GitHub Advanced Security, ou a análise estática do código continua sendo
revisão humana.

O Scorecard não será substituído: ele pontua postura de projeto aberto, que este
repositório deixou de ser.

## Pendências conhecidas

- **Nenhum runbook foi exercitado**, porque a infraestrutura ainda não existe.
  Um procedimento nunca testado falha exatamente quando é necessário.
- **Não há análise estática de segurança do código.** Ver a seção acima.
- **O check `Dependencies` ainda não é obrigatório para o merge.** O
  `infra/repo/main.tf` já o declara e `internal/infra/src/repo.test.ts` garante
  que todo check exigido é reportado por algum job, mas os rulesets vivos no
  GitHub exigem só `Lint, typecheck, test, build` e `Validate PR source branch`,
  e ninguém aplicou o `infra/repo`.
- **Padrões próprios de secret scanning** para `nekolog_sk_` e `nekolog_pk_`
  ainda não foram configurados no GitHub (ameaça I9).
- **O *trusted publisher* de cada pacote no npmjs.com** ainda não existe, por
  não existir a conta. O workflow já publica por OIDC e não carrega nenhum
  token, mas o npm só aceita depois que o pacote apontar para este repositório
  e para `release.yml` (ameaça S7, etapa 6.7).
- **Varredura do ZAP a cada promoção** depende de o deploy ser ligado.

Resolvida desde a versão anterior desta página: a recriptografia da
`ENCRYPTION_KEY`, que era a pendência mais grave — rotacionar aquela chave sem
ela tornaria ilegíveis os segredos cifrados no banco. A etapa 5.10 criou o
`resealChannelSecrets`, com *dry run*, idempotente e com escrita condicional, e
o [runbook](../runbooks/rotacao-de-segredos.md#3-chave-de-criptografia-do-banco-encryption_key)
passou a apontar para ele.
