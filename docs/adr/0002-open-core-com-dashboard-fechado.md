# ADR 0002 — Open-core, com o dashboard fechado

- **Status:** aceita
- **Data:** 2026-10-30
- **Plano:** seções 1, 2, 5, 10, 18 e 20

## Contexto

O plano original era open source por inteiro, MIT, num único repositório: SDKs,
ingestão, jobs e dashboard. Isso atendia bem o lado portfólio e o self-host
completo.

O problema apareceu ao separar os dois objetivos que o projeto tem ao mesmo
tempo. O código aberto serve de portfólio e permite que outras pessoas rodem a
plataforma. Mas o dashboard é a parte que dá vantagem competitiva à instância
hospedada — é o trabalho de interface, não a ingestão. Publicá-lo significa que
qualquer pessoa pode subir uma cópia completa do produto.

A decisão foi tomada no meio do M0, com o `apps/web` já criado como scaffold do
dashboard e o M2 inteiro planejado em cima da premissa de monorepo único.

## Decisão

Modelo **open-core**, em dois repositórios:

- **`nekolog-io`** (público, MIT): SDKs, ingestão, jobs, API pública de leitura,
  landing page e documentação. Self-hostável com Docker.
- **`nekolog-dashboard`** (privado): o dashboard Next.js. Roda **só** na
  instância hospedada.

O self-host passa a cobrir só o repositório público. Quem hospeda por conta
própria envia logs, consulta pela API pública de leitura e recebe alertas, mas
não tem interface web.

O `apps/web` que já existia é reaproveitado como **landing page pública**, não
como dashboard. O tema Grafite, o `next-themes` e o `next-intl` servem igual
para os dois.

## Consequências

- **O self-host fica claramente pior.** Sem interface, o valor para quem
  hospeda cai muito: resta uma API. É o custo direto e consciente da decisão.
  Isso precisa estar explícito no README e na documentação, não escondido —
  descobrir isso depois de subir a stack inteira seria uma péssima experiência.
- **A promessa do plano mudou.** O README e a seção 5 do plano prometiam
  self-host completo. Foram corrigidos junto com esta decisão; não dá para
  deixar a documentação prometendo o que não se entrega.
- **Compartilhar código entre os repositórios vira um problema real e não
  resolvido.** O dashboard precisa do mesmo Postgres (`internal/db`) e
  provavelmente de `internal/schema` e parte de `internal/adapters`. As opções
  (registro privado, duplicação, ou acesso só via banco) estão listadas na
  seção 2 do plano e precisam ser decididas antes do M2.
- **`internal/auth` muda de casa.** Senhas, OTP, JWT e sessões são exclusivos do
  dashboard e nascem no repositório privado. `internal/db` fica no público,
  porque `apps/jobs` também lê e grava nesse banco.
- **O M2 precisa ser replanejado.** As etapas 2.1–2.25 do ETAPAS.md descrevem o
  dashboard como se vivesse neste monorepo. Continuam válidas como escopo, mas
  a numeração e as branches serão recriadas no repositório novo.
- **Dois repositórios, dois CIs, dois conjuntos de segredos.** Mais custo
  operacional para uma pessoa só manter.
- A licença MIT continua valendo para tudo que está no repositório público.

## Alternativas consideradas

- **Manter tudo open source.** O que estava planejado. Descartado porque expõe
  integralmente a parte do produto que diferencia a instância hospedada.
- **Dashboard fechado, mas distribuído como imagem Docker.** Preservaria o
  self-host completo sem publicar o código. Descartado por agora: exige manter
  um pipeline de build e publicação de imagem, versionada e segura, para um
  projeto de uma pessoa — e o self-host não é o objetivo principal. Pode ser
  revisitado se houver demanda real.
- **Licença source-available (BSL, Elastic License) no mesmo repositório.** O
  código ficaria visível mas com uso restrito. Descartado porque o objetivo é
  justamente **não** expor o código do dashboard; visibilidade com restrição
  legal não resolve isso, só adiciona complexidade de licenciamento.
