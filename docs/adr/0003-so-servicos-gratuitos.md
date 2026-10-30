# ADR 0003 — Rodar só em serviços gratuitos

- **Status:** aceita
- **Data:** 2026-10-29
- **Plano:** seções 1, 4 e 22

## Contexto

O NekoLog é um projeto pessoal de estudo, sem receita. Uma plataforma de logs é
cara de operar por natureza: recebe volume alto, guarda muito dado e consulta
muito. Qualquer escolha de arquitetura feita sem orçamento em mente leva a uma
conta mensal que o projeto não sustenta, e o projeto morre.

## Decisão

Toda a plataforma roda nos planos gratuitos permanentes dos provedores. O único
gasto recorrente aceito é o domínio `nekolog.io` (~US$ 50/ano no Cloudflare),
exigido pela Resend (domínio verificado) e pelo Cloudflare Tunnel.

Essa restrição é **estruturante**, não uma preferência: ela é a causa de boa
parte das outras decisões — ClickHouse numa VM em vez de serviço gerenciado
(ADR [0004](0004-clickhouse-em-vm-oracle.md)), ingestão em Workers
(ADR [0005](0005-ingestao-hono-em-workers.md)), keys no KV para não tocar o
Postgres no caminho quente, e cotas na instância hospedada.

## Consequências

- **Os limites dos planos viram requisitos de arquitetura.** Os 10 ms de CPU
  por request do Worker proíbem validação pesada na ingestão. Os 100 e-mails por
  dia da Resend são o motivo do refresh token de longa duração. Os 50
  subrequests por execução do Worker moldam como os jobs agrupam as regras de
  alerta. Nenhum desses números é negociável de dentro do código.
- **Os três ambientes dividem as mesmas cotas.** Os limites são por conta, não
  por projeto. `dev` e `qa` precisam ter tráfego baixo e e-mails restritos a uma
  lista de endereços autorizados, senão consomem a cota de produção.
- **A instância hospedada precisa ser por convite, com cotas.** Sem isso,
  qualquer pico de uso de terceiros estoura o plano gratuito e derruba tudo.
- **Risco de mudança unilateral.** Os provedores cortam cotas sem aviso — a
  Oracle reduziu o Always Free em 2026, o ClickHouse Cloud acabou com o plano
  gratuito permanente. Cada peça precisa de um plano B (seção 22 do plano) e os
  limites precisam ser reconferidos antes de depender deles.
- **Nada disso escala comercialmente.** Se o projeto um dia precisar crescer, a
  arquitetura terá que ser revisitada. Isso é aceito: a restrição é a premissa,
  não um acidente.

## Alternativas consideradas

- **Uma VPS paga (~US$ 5–20/mês) rodando tudo.** Muito mais simples: um
  docker-compose, sem distribuir a arquitetura entre cinco provedores.
  Descartada porque custo recorrente é exatamente o que mata projeto pessoal, e
  porque a distribuição força um desenho mais interessante de estudar.
- **Créditos de trial (AWS, GCP, ClickHouse Cloud).** Descartada porque
  expiram. Uma arquitetura que depende de trial tem data de morte marcada.
- **Rodar só local, sem instância hospedada.** Descartada porque uma demo
  pública funcionando é parte do objetivo de portfólio.
