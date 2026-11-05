---
title: Introdução
description: O que é o NekoLog, como ele é montado e o que você recebe.
---

O NekoLog é uma plataforma de logs para aplicações JavaScript e TypeScript, no
front-end e no back-end. Você instala um SDK, ele junta seus logs em lotes e
envia para uma API de ingestão, eles são guardados no ClickHouse, e você busca e
visualiza tudo num dashboard — com keys de API separadas por ambiente.

:::caution[Por convite]
Não existe cadastro aberto. Um convite dá acesso ao dashboard e aos pacotes;
[fale com a gente](mailto:contato@nekolog.io) se quiser um.
:::

## Como as peças se encaixam

- **SDKs** (`@nekolog-io/*`) coletam logs na sua aplicação e enviam em lotes.
  Nunca quebram a sua aplicação e não têm nenhuma dependência.
- **A ingestão** valida cada lote e grava no ClickHouse. Ela não faz mais nada —
  sem agrupamento, sem alertas — para continuar rápida.
- **Os jobs** rodam a cada minuto para agrupar erros em issues, avaliar regras de
  alerta e acompanhar uso e cotas.
- **O dashboard** é onde você busca logs, lê traces e gerencia projetos.

## O que você recebe

Duas coisas, e você não roda nenhuma das duas:

- **O SDK da sua stack**, instalado dentro da sua aplicação. É a única parte do
  NekoLog que roda do seu lado.
- **Um login no dashboard**, onde você busca seus logs, lê traces, vê issues e
  configura alertas.

Todo o resto — a ingestão, o armazenamento, os jobs — roda na nossa instância.
Não há nada para implantar, nada para manter no ar e nenhum banco seu para
dimensionar.

O NekoLog é software proprietário. O SDK é seu para instalar e embarcar na sua
aplicação; não é seu para republicar nem para montar um serviço de logs. Os
termos completos vêm junto com o contrato.

Se você preferir não usar nossos SDKs, a ingestão fala
[OTLP/HTTP](/docs/pt-br/api/otlp/) e o seu exportador OpenTelemetry atual pode
apontar direto para ela.

## Keys e ambientes

Todo projeto tem ambientes (`production`, `staging`, `development` e outros que
você criar), e cada ambiente tem suas próprias keys:

- `nekolog_pk_…` — **pública**, só escrita, segura para usar no navegador.
- `nekolog_sk_…` — **secreta**, usada no back-end, com escopos
  (`logs:write`, `logs:read`).

A key define o ambiente, então o SDK nunca precisa da opção `environment` e uma
key de staging nunca consegue gravar em produção.
