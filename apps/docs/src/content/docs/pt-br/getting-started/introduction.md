---
title: Introdução
description: O que é o NekoLog, como ele é montado e o que é open source.
---

O NekoLog é uma plataforma de logs para aplicações JavaScript e TypeScript, no
front-end e no back-end. Você instala um SDK, ele junta seus logs em lotes e
envia para uma API de ingestão, eles são guardados no ClickHouse, e você busca e
visualiza tudo num dashboard — com keys de API separadas por ambiente.

:::caution[Em desenvolvimento inicial]
Nada foi publicado no npm ainda. Estas páginas descrevem o comportamento
desenhado; veja [o roteiro](https://github.com/gabrielbarbosaa/nekolog-io/blob/main/docs/ETAPAS.md)
para saber o que já existe hoje.
:::

## Como as peças se encaixam

- **SDKs** (`@nekolog-io/*`) coletam logs na sua aplicação e enviam em lotes.
  Nunca quebram a sua aplicação e não têm nenhuma dependência.
- **A ingestão** valida cada lote e grava no ClickHouse. Ela não faz mais nada —
  sem agrupamento, sem alertas — para continuar rápida.
- **Os jobs** rodam a cada minuto para agrupar erros em issues, avaliar regras de
  alerta e acompanhar uso e cotas.
- **O dashboard** é onde você busca logs, lê traces e gerencia projetos.

## Open core

Este projeto é **open core**:

- Os SDKs, a API de ingestão, os jobs e a API pública de leitura são open source
  sob MIT, no repositório
  [`nekolog-io`](https://github.com/gabrielbarbosaa/nekolog-io). Você pode
  hospedar tudo isso por conta própria com Docker.
- **O dashboard é de código fechado** e roda apenas na instância hospedada. Ele
  não faz parte do self-host.

Se você hospedar por conta própria, envia logs, consulta pela API pública de
leitura e recebe alertas — mas não tem a interface web.

## Keys e ambientes

Todo projeto tem ambientes (`production`, `staging`, `development` e outros que
você criar), e cada ambiente tem suas próprias keys:

- `nekolog_pk_…` — **pública**, só escrita, segura para usar no navegador.
- `nekolog_sk_…` — **secreta**, usada no back-end, com escopos
  (`logs:write`, `logs:read`).

A key define o ambiente, então o SDK nunca precisa da opção `environment` e uma
key de staging nunca consegue gravar em produção.
