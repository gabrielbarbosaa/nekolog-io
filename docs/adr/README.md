# Architecture Decision Records

Registro das decisões de arquitetura do NekoLog: **o que** foi decidido, **por
que**, e **o que isso custa**. O [PLANO.md](../PLANO.md) resume as decisões numa
tabela; aqui cada uma tem o contexto, as alternativas descartadas e as
consequências que se aceitou conviver.

## Índice

| # | Decisão | Status |
|---|---|---|
| [0001](0001-registrar-decisoes-de-arquitetura.md) | Registrar decisões de arquitetura | Aceita |
| [0002](0002-open-core-com-dashboard-fechado.md) | Open-core, com o dashboard fechado | Aceita |
| [0003](0003-so-servicos-gratuitos.md) | Rodar só em serviços gratuitos | Aceita |
| [0004](0004-clickhouse-em-vm-oracle.md) | ClickHouse numa VM Oracle Always Free | Aceita |
| [0005](0005-ingestao-hono-em-workers.md) | Ingestão com Hono no Cloudflare Workers | Aceita |
| [0006](0006-keys-por-ambiente.md) | Keys públicas e secretas por ambiente | Aceita |
| [0007](0007-autenticacao-propria.md) | Autenticação própria, sem Better Auth | Aceita |
| [0008](0008-jwt-curto-com-refresh-rotativo.md) | JWT curto com refresh token rotativo | Aceita |
| [0009](0009-opentofu-para-infraestrutura.md) | OpenTofu para infraestrutura como código | Aceita |
| [0010](0010-tres-branches-de-longa-duracao.md) | Três branches de longa duração | Aceita |
| [0011](0011-tres-idiomas.md) | Três idiomas na interface e na documentação | Aceita |
| [0012](0012-escolha-de-bibliotecas.md) | Escolha de bibliotecas (ECharts, Valibot, runner próprio) | Aceita |

## O que vira ADR e o que não vira

Nem toda linha da seção 1 do plano virou ADR. Um ADR existe quando a decisão é
**arquitetural** — quando mudá-la depois é caro, ou quando alguém olhando o
código vai perguntar "por que assim?".

Ficaram **fora**, registradas só no plano, as decisões que são preferência ou
processo e não restringem a arquitetura: o nome do projeto, a paleta visual, o
escopo até a 1.0, o acompanhamento por issues, o mapa de telas, e as cotas da
instância hospedada (números ajustáveis pelo operador, não um contrato).

"Segurança é prioridade máxima" também não virou ADR: é um princípio que
atravessa todas as decisões, detalhado na seção 14 do plano, não uma escolha
entre alternativas.

## Formato

Cada ADR tem status, data, contexto, a decisão, as consequências (incluindo as
ruins) e as alternativas consideradas. Um ADR aceito **não é editado** quando a
decisão muda: cria-se um novo que o substitui, e o antigo passa a
`Substituída por NNNN`. O histórico é o valor.

## Idioma

Em português, como o resto de `docs/`. Commits, branches, PRs e código
continuam em inglês (ADR [0011](0011-tres-idiomas.md)).
