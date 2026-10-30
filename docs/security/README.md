# Segurança

Segurança é prioridade em todas as camadas: a plataforma recebe dados de
terceiros, guarda credenciais e publica pacotes que rodam dentro da aplicação de
outras pessoas (plano, seção 14).

| Documento | O que é |
|---|---|
| [threat-model.md](threat-model.md) | Modelo de ameaças STRIDE por fronteira de confiança, com o status de cada mitigação e a lista do que foi aceito sem mitigação completa. |
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
  controle de acesso, validação de entrada e configuração. A revisão completa
  acontece na etapa 6.5, antes da 1.0; até lá ele guia as decisões em vez de ser
  auditado formalmente.
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

Ainda **não** existem, e estão previstos: fuzzing do validador de payload e do
parser da busca, testes de IDOR entre organizações, varredura do OWASP ZAP em
`qa` a cada promoção, e teste automático dos cabeçalhos de segurança.

## Pendências conhecidas

Levantadas ao escrever os runbooks, e que precisam virar trabalho de verdade:

- **Não existe script de recriptografia para a `ENCRYPTION_KEY`.** Rotacionar
  essa chave hoje tornaria ilegíveis os segredos cifrados no banco, sem
  recuperação. Precisa existir antes do M5, quando canais de alerta passarem a
  guardar segredo
  ([runbook](../runbooks/rotacao-de-segredos.md#3-chave-de-criptografia-do-banco-encryption_key)).
- **Nenhum runbook foi exercitado**, porque a infraestrutura ainda não existe.
  Um procedimento nunca testado falha exatamente quando é necessário.
- **Padrões próprios de secret scanning** para `nekolog_sk_` e `nekolog_pk_`
  ainda não foram configurados no GitHub.
