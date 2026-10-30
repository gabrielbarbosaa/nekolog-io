# ADR 0011 — Três idiomas na interface e na documentação

- **Status:** aceita
- **Data:** 2026-10-29
- **Plano:** seções 1 e 13

## Contexto

Ferramenta de observabilidade é um mercado dominado pelo inglês, e a
documentação em português da área é escassa. O autor é brasileiro. Há uma
oportunidade clara de alcance na comunidade latino-americana, e isso também é
diferencial de portfólio.

Ao mesmo tempo, um projeto open source que mistura idiomas no código fica
hostil para contribuição externa.

## Decisão

Uma linha clara entre **o que o usuário lê** e **o que o desenvolvedor lê**:

- **Em português (pt-BR), inglês e espanhol:** dashboard, documentação,
  e-mails e README. O inglês é o idioma de origem e o fallback.
- **Só em inglês:** código, comentários, commits, branches, PRs e as mensagens
  de aviso do SDK no console. Issues em português e espanhol são bem-vindas.

O idioma vem da preferência salva no perfil ou, no primeiro acesso, do
`Accept-Language`. Datas e números usam `Intl`, no idioma e no fuso de cada
pessoa.

Os documentos internos de planejamento (`docs/PLANO.md`, `docs/ETAPAS.md`,
`docs/ESPECIFICACOES.md`, `docs/process/`, e estes ADRs) ficam em português —
são o caderno de trabalho do autor, não material de usuário.

## Consequências

- **Todo texto de interface custa três vezes.** É o custo recorrente desta
  decisão, pago em cada PR que adiciona uma string.
- **Tradução faltando precisa quebrar o build, não degradar silenciosamente.**
  O fallback para inglês é invisível em revisão — a página simplesmente aparece
  meio traduzida. Por isso a etapa 0.13 existe: `apps/web/i18n/messages.test.ts`
  falha se uma chave estiver faltando, sobrando ou vazia, e
  `apps/docs/tests/i18n-parity.test.ts` falha se uma página não tiver tradução.
- **As docs têm três árvores de conteúdo para manter em sincronia.** Uma página
  nova só pode ser mergeada com as três versões prontas.
- **E-mails multiplicam templates.** Cada tipo de e-mail precisa das três
  versões no React Email.
- **Qualidade de tradução depende do autor.** Sem revisão nativa de espanhol,
  há risco de texto que soa traduzido. Aceito; correção por contribuição
  externa é bem-vinda.
- **A documentação interna em português limita contribuição de fora.** Quem não
  lê português não entende as decisões do projeto. Aceito por agora, dado que a
  leitura essencial para contribuir (README e docs) está nos três idiomas.

## Alternativas consideradas

- **Só inglês.** O padrão do mercado e o mais barato de manter. Descartado
  porque elimina justamente o diferencial do projeto.
- **Só português.** Fecharia o projeto num público pequeno e tornaria os SDKs
  no npm estranhos para o resto do mundo.
- **Inglês e português, sem espanhol.** Reduziria um terço do custo. O espanhol
  foi mantido porque amplia muito o alcance na América Latina com conteúdo
  bastante próximo do português.
- **Tradução automática na interface.** Barato. Descartado: texto de produto
  traduzido por máquina, sem revisão, passa impressão de descuido justamente nas
  telas que o usuário mais lê.
