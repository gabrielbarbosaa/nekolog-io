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
| CodeQL | Padrões de vulnerabilidade em JS/TS |
| `dependency-review` | Dependência com vulnerabilidade conhecida ou licença incompatível |
| OpenSSF Scorecard | Postura de segurança do repositório |
| Dependabot + Renovate | Atualização de dependência e de action |
| Secret scanning + push protection | Segredo commitado |
| Branch rulesets | Push direto, force push, commit não assinado em `main`/`qa` |

Já existem também: fuzzing do validador de payload e do parser da busca, teste
automático dos cabeçalhos de segurança nos dois sites e nas duas APIs, e o
orçamento de CPU da ingestão medido em teste. A varredura do ZAP é **manual** —
ver [zap/](zap/README.md) — porque a automática a cada promoção depende de `qa`
existir. Teste de IDOR entre organizações é do dashboard.

## Pendências conhecidas

- **Nenhum runbook foi exercitado**, porque a infraestrutura ainda não existe.
  Um procedimento nunca testado falha exatamente quando é necessário.
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
