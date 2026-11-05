# ADR 0017 — Licença proprietária e repositório privado

- **Status:** aceita
- **Data:** 2026-11-05
- **Substitui:** [0002](0002-open-core-com-dashboard-fechado.md)
- **Plano:** seções 1, 2, 13 e 20

## Contexto

A [0002](0002-open-core-com-dashboard-fechado.md) dividiu o projeto em duas
metades: este repositório aberto sob MIT, com os SDKs, a ingestão, os jobs, a
API de leitura, o site e a documentação, e o dashboard fechado num repositório
privado. A linha foi desenhada para servir a dois objetivos ao mesmo tempo —
portfólio público e vantagem competitiva na instância hospedada.

Em 05/11/2026 o objetivo mudou: o projeto passa a ser um produto privado e
pago. Isso não é um ajuste da 0002, é a remoção da metade aberta dela.

A MIT é o que dá o produto. Enquanto ela valer, qualquer pessoa pode subir uma
cópia da plataforma e cobrar por ela, e **cada commit que entra sob MIT é doado
de forma irreversível** — o que torna a decisão urgente, não opcional.

## Decisão

- **Licença proprietária**, todos os direitos reservados, com **uma concessão
  estreita**: os pacotes de SDK podem ser instalados, usados e redistribuídos
  sem modificação como componente da aplicação de quem contrata, apenas para
  mandar telemetria ao serviço. O servidor, as bibliotecas compartilhadas e a
  infraestrutura não têm concessão nenhuma.
- **Repositório privado.** O código-fonte não é entregue a ninguém.
- **O cliente recebe duas coisas:** a lib, instalada a partir de um registro, e
  um login no dashboard hospedado. Ele nunca roda o servidor.
- O texto MIT que valeu até o commit `966f509` fica em
  `LICENSES/MIT-historical.txt`. Essa concessão não é revogável para o material
  que ela cobriu, e o registro do que ela cobriu vale mais que a ausência dele.
  Nenhum pacote chegou a ser publicado sob ela.

## Alternativas descartadas

- **Licença *source-available*** (FSL, BSL 1.1, Elastic 2.0, PolyForm Shield).
  Mantêm o código à vista e proíbem competir; a FSL ainda converte em MIT depois
  de dois anos. Era a recomendação técnica, porque preserva o portfólio sem
  entregar o produto, e foi recusada: a decisão é não mostrar o código.
- **Manter os SDKs sob MIT**, como Sentry faz. Reduz atrito de adoção — o
  jurídico de quem contrata costuma barrar dependência restritiva dentro do
  próprio bundle. Recusada pelo mesmo motivo.
- **Licença 100% fechada, sem concessão nenhuma.** Descartada por ser
  autodestrutiva: sem o direito de executar e embarcar o SDK, quem paga não
  consegue usar o produto.

## Consequências aceitas

- **O portfólio público acaba.** Era a razão declarada do projeto na seção 1 do
  plano, e deixa de existir.
- **CodeQL, dependency review e OpenSSF Scorecard param.** Os dois primeiros
  exigem GitHub Advanced Security em repositório privado; o Scorecard lê
  repositório público. Os dois primeiros eram checks obrigatórios nas três
  branches e precisaram sair da lista, senão nenhum PR mergeia. Substituí-los
  é etapa própria — e a política de licença de dependências, que recusava GPL e
  AGPL, importa **mais** agora, não menos: puxar AGPL sem perceber para dentro
  de um produto proprietário é problema jurídico.
- **A proveniência do npm acaba.** O npm não gera atestação a partir de
  repositório privado, mesmo com trusted publishing.
- **Os minutos de CI passam a ser contados** — 2.000 por mês no plano Free,
  contra ilimitado em repositório público.
- **O README em três idiomas perde a razão.** A regra da
  [0011](0011-tres-idiomas.md) continua valendo para o que o cliente lê — site,
  documentação, dashboard e e-mails —, e não para um documento interno que um
  grupo só lê. As duas traduções do README foram removidas.
- **Ninguém descobre o produto sozinho.** Sem presença pública, a distribuição
  é por convite, e o post de lançamento perde o destino.
- **A distribuição dos quatro pacotes compartilhados vira pergunta aberta.** A
  [0016](0016-pacotes-compartilhados-no-npm.md) os publicou no npm público
  porque o dashboard precisa instalá-los; publicá-los agora é entregar o esquema
  do Postgres e as implementações de servidor.
