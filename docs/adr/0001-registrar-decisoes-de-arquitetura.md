# ADR 0001 — Registrar decisões de arquitetura

- **Status:** aceita
- **Data:** 2026-10-30

## Contexto

O NekoLog é um projeto de uma pessoa só, construído ao longo de meses e em
público. A tabela da seção 1 do [PLANO.md](../PLANO.md) diz *o que* foi
decidido e dá uma linha de motivo, mas não cabe nela o que realmente importa
daqui a seis meses: quais alternativas foram descartadas, e com que custo se
concordou em conviver.

Sem isso, duas coisas acontecem. O próprio autor volta a uma decisão antiga,
não lembra por quê, e ou a refaz igual depois de pesquisar tudo de novo, ou a
desfaz sem perceber a restrição que a motivou. E quem chega de fora num
repositório público não tem como distinguir uma escolha deliberada de um
acidente.

## Decisão

Manter ADRs em `docs/adr/`, numerados sequencialmente, cada um cobrindo uma
decisão arquitetural com contexto, alternativas e consequências.

Um ADR aceito não é editado quando a realidade muda. Cria-se um novo que o
substitui, e o antigo recebe `Status: substituída por NNNN`. O registro de que
se pensou diferente antes é parte do valor.

Nem toda decisão vira ADR — só as arquiteturais, pelo critério descrito no
[README](README.md) deste diretório. Preferência e processo ficam no plano.

## Consequências

- Toda decisão arquitetural custa um arquivo a mais no PR. É intencional: se a
  decisão não merece dez minutos de escrita, provavelmente não é arquitetural.
- Os ADRs vão divergir do código com o tempo — um ADR descreve o que se decidiu
  **naquela data**, não o estado atual. Quem lê precisa tratar como histórico,
  não como documentação de referência. O plano e o código são a verdade do
  presente.
- Ficam duas fontes sobre as mesmas decisões (a tabela do plano e os ADRs). A
  tabela continua sendo o resumo navegável; o ADR é o aprofundamento. Se
  divergirem, o ADR mais recente vence.

## Alternativas consideradas

- **Só a tabela do plano.** É o que existia. Funciona como índice, mas não tem
  espaço para alternativas descartadas — exatamente a informação que se perde
  primeiro e que mais faz falta depois.
- **Registrar nas mensagens de commit.** O histórico já é bom (Conventional
  Commits, um commit por etapa), mas decisões não mapeiam para commits: a
  escolha do ClickHouse afeta dezenas deles e não "pertence" a nenhum.
- **Issues ou Discussions do GitHub.** Ficam fora do repositório, não aparecem
  num clone, e dependem do GitHub continuar existindo e acessível.
