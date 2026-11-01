# @internal/tracking

O `docs/ETAPAS.md` é a fonte da verdade do roadmap. Este pacote **projeta** esse
arquivo no GitHub: um milestone por marco, um label por prefixo de branch e uma
issue por etapa.

```bash
pnpm tracking                   # simulação: diz o que faria, não cria nada
pnpm tracking -- --apply        # cria de verdade
pnpm tracking -- --apply --include-done
```

## Simulação é o padrão

Criar issue é público e não dá para desfazer em lote. Então `--apply` é
obrigatório e explícito, e sem ele o comando só imprime o plano — inclusive o
nome do repositório em que ia mexer, que é o jeito de perceber que você está no
`gh` logado na conta errada antes e não depois.

## Rodar duas vezes não cria nada duas vezes

Antes de montar o plano, o script lê o que já existe: os milestones pelo título,
os labels pelo nome e as issues pelo título (**incluindo as fechadas**, senão
fechar uma issue faria a próxima execução recriá-la). O que já existe sai do
plano.

Por isso o comando também serve para **acrescentar**: etapa nova no
`docs/ETAPAS.md`, roda de novo, e só a issue nova é criada.

O que ele **não** faz é apagar, renomear ou fechar nada. Issue que saiu do
ETAPAS continua lá; quem decide o que fazer com ela é uma pessoa.

## As etapas já concluídas ficam de fora

Por padrão só viram issue as etapas ainda não marcadas. As concluídas já têm um
PR mergeado como registro, e uma issue fechada sem PR vinculado é um registro
pior que nenhum. O `--include-done` existe para quem quiser o espelho exato.

## Formato que ele espera

```markdown
## M1 — Ingestão

- [x] **1.1** `feat/schema-v1` — formato do payload v1.
```

O marco vem do cabeçalho `## M<n> — <nome>`; a etapa precisa do número em
negrito, da branch entre crases e do travessão. Linha sem número — as tarefas
manuais no topo do arquivo — é ignorada, e etapa numerada antes do primeiro
marco também.

A descrição do milestone é o "pronto quando" da tabela da seção 19 do
`docs/PLANO.md`. Se a tabela mudar de forma, o milestone nasce com um texto
genérico em vez de o script quebrar.

## Por que isso é um pacote, e não um script solto

Porque o jeito de isso dar errado é silencioso: alguém muda a forma de uma linha
do `docs/ETAPAS.md`, o regex para de casar, e o script cria 30 issues em vez de
79 sem reclamar de nada. Os testes rodam contra o **arquivo de verdade** e
falham se o número de etapas lidas não bater com o número de linhas numeradas no
arquivo, se um número de etapa repetir, ou se aparecer um prefixo de branch sem
label definido.

```bash
pnpm --filter @internal/tracking test
```

A parte que fala com o GitHub (`src/cli.ts`) é fina de propósito: quem decide o
que criar é o `buildPlan`, que é função pura e tem teste.

## Limite de criação

As issues são criadas uma a uma, com 1,2 s entre elas, porque o GitHub corta
quem cria conteúdo rápido demais (o limite secundário é da ordem de 80 por
minuto). Uma que falhe não interrompe as outras: no fim o script lista as que
não entraram e sai com código diferente de zero. Como ele é idempotente, a saída
para isso é rodar de novo.

Toda chamada ao `gh` tem prazo de 30 s. Um comando que fica esperando algo que
nunca vem morre em meio minuto, em vez de pendurar a execução inteira em
silêncio — foi exatamente assim que a primeira versão falhou, mandando o corpo
da issue por stdin num `execFile` assíncrono, que não escreve stdin nenhum. Hoje
o corpo vai como argumento, e tem teste exigindo que continue assim.
