# ADR 0009 — OpenTofu para infraestrutura como código

- **Status:** aceita
- **Data:** 2026-10-29
- **Plano:** seções 1 e 15.5

## Contexto

A infraestrutura está espalhada por cinco provedores (Cloudflare, Oracle,
Vercel, Neon, Upstash), com três ambientes cada. Configurar isso clicando em
painel significa que ninguém — nem o autor, seis meses depois — sabe o estado
real, e recriar após um incidente vira arqueologia.

A VM Oracle, em particular, é explicitamente tratada como descartável
(ADR [0004](0004-clickhouse-em-vm-oracle.md)); isso só é verdade se existir
script que a recrie.

## Decisão

**OpenTofu** a partir do M1, em `infra/`, com módulos compartilhados e um
diretório por ambiente (`infra/envs/{dev,qa,prod}`).

Entram no código: DNS, Tunnel, Access, Turnstile, Email Routing, KV, R2 e rotas
dos Workers (Cloudflare); VM e regras de rede (Oracle); projeto e domínios
(Vercel); repositório, rulesets e environments (GitHub). Neon e Upstash entram
se os providers atenderem; senão ficam documentados em runbook.

**Estado no R2, com a criptografia de estado nativa do OpenTofu** — o estado
contém segredos e não pode ficar em claro.

**Fluxo:** PR que toca `infra/` roda `tofu plan` e mostra o plano no PR; `apply`
roda no merge, com aprovação manual em produção. Segredos entram por variáveis
dos environments do GitHub, nunca no código.

## Consequências

- **Mudança de infraestrutura passa a custar um PR.** Mais lento que clicar no
  painel, e é o ponto: fica revisável e com histórico.
- **Criptografia de estado é obrigatória, não opcional.** O estado tem token e
  credencial em claro. Perder a `TOFU_STATE_PASSPHRASE` significa perder o
  controle do estado — ela precisa estar no runbook de rotação de segredos.
- **Cobertura vai ser parcial.** Nem todo provedor tem provider decente. O que
  ficar de fora precisa estar em runbook, senão vira exatamente o conhecimento
  tácito que esta decisão tenta eliminar.
- **Drift continua possível.** Mexer pelo painel e não refletir no código deixa
  o estado mentindo. Disciplina, não garantia técnica.
- **Mais uma ferramenta.** HCL, estado, providers e um ciclo de CI próprio para
  aprender e manter.

## Alternativas consideradas

- **Terraform.** Praticamente o mesmo produto, com ecossistema maior e mais
  documentação. Descartado pela mudança de licença da HashiCorp para BUSL em
  2023: um projeto open source prefere não depender de ferramenta
  source-available. O OpenTofu é o fork sob a Linux Foundation e mantém
  compatibilidade com os mesmos providers.
- **Pulumi.** Infraestrutura em TypeScript, mesma linguagem do resto do
  projeto. Descartado porque o backend de estado gerenciado é pago e o
  self-managed adiciona complexidade, e porque o ecossistema de providers para
  Oracle e Cloudflare é menos maduro.
- **Scripts com as CLIs dos provedores.** Sem estado, sem ferramenta nova.
  Descartado: scripts imperativos não são idempotentes nem detectam drift, e
  acabam virando um Terraform ruim.
- **Deixar tudo manual, documentado em runbook.** O que vale até o M1.
  Descartado como solução final: runbook não é executável e envelhece sem
  ninguém notar.
