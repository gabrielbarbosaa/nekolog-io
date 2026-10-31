# ADR 0014 — Ordem do pipeline de privacidade e amostragem no SDK

- **Status:** aceita
- **Data:** 2026-10-31
- **Plano:** seções 3 (princípio 5), 6 e 8
- **Relacionada:** [0002](0002-open-core-com-dashboard-fechado.md) (open core)

## Contexto

O princípio 5 da seção 3 do plano diz que dado sensível é removido **no SDK e no
servidor**, e a seção 8 lista o que sai por padrão: `password`, `token`,
`authorization`, `cpf` e número de cartão.

A etapa 1.5 implementa a parte do SDK. Junto dela entram duas outras peças que
decidem se um evento existe e com que conteúdo: a **amostragem** e o
**`beforeSend`**, um gancho onde o usuário do SDK altera ou descarta o evento.

As três mexem no mesmo evento, e a ordem entre elas muda a garantia que a
plataforma consegue dar. Três perguntas precisavam de resposta:

1. A remoção roda antes ou depois do `beforeSend`?
2. A amostragem sorteia por evento ou por trace?
3. A amostragem pode descartar um `error`?

## Decisão

O pipeline é **amostragem → `beforeSend` → remoção**, e dentro dele:

**A remoção é a última etapa.** O `beforeSend` recebe o evento cru — é isso que
permite rotear por um valor real antes de ele sumir — mas o que ele devolve
ainda passa pela remoção. Um gancho não consegue desfazer a garantia de
privacidade, nem por engano nem de propósito.

**A amostragem é consistente por trace.** Quando o evento tem `trace.traceId`, a
decisão vem de um hash FNV-1a do trace, não de um sorteio. Todos os logs da
mesma request são mantidos juntos ou descartados juntos. Sem trace, é sorteio
mesmo.

**`error` e `fatal` nunca são amostrados por padrão.** Existe um piso,
`sampling.alwaysFrom`, que começa em `error`. Quem quiser amostrar erro também
passa `alwaysFrom: false`, explicitamente.

Como consequência da ordem, o `beforeSend` roda **depois** da amostragem: um
evento já descartado nunca chega ao gancho. E o que o gancho devolve é
**revalidado** contra o contrato da ingestão antes de seguir — nível, timestamp,
tamanho da mensagem, atributos, trace, sessão, fingerprint.

## Consequências

- **O `beforeSend` não enxerga o resultado da remoção.** Quem quiser decidir com
  base no texto já limpo precisa chamar `redactText` por conta própria. É o
  preço de a privacidade ter a última palavra.
- **Sobre-remoção acontece.** A busca por chave é por conteúdo
  (`tokenCount` casa com `token`), porque errar para o lado de remover é melhor
  do que vazar. A saída é `privacy.skipKeys`, que tira uma chave exata do
  caminho sem desarmar o resto da lista.
- **A amostragem por trace não é uniforme em volume.** Uma request que gera 500
  logs entra ou sai inteira, então a taxa vale para *traces*, não para linhas. É
  exatamente o que se quer para depurar, e atrapalha quem usa a amostragem só
  para prever custo.
- **O piso em `error` deixa a conta de erro certa.** Alerta e cálculo de issue
  (M3) leem contagem de erro; se a amostragem pudesse derrubar erro em silêncio,
  todo alerta precisaria dividir pela taxa — e a taxa muda por ambiente.
- **Um `beforeSend` que esquece o `return` descarta os logs.** Segue a convenção
  do Sentry, que é o que a maioria espera. Para o engano não ser silencioso, o
  SDK avisa uma vez pelo `onError` dizendo exatamente isso.
- **Um `beforeSend` que lança descarta aquele evento**, em vez de mandá-lo cru. O
  gancho é onde o usuário tira PII; se ele falhou no meio, o evento pode estar
  com o dado que ele ia tirar.
- **Custo de CPU por evento.** São cinco varreduras de regex sobre a mensagem e
  sobre cada atributo de texto. Em lote de 500 eventos isso é medível, e é por
  isso que `privacy.scrubText: false` existe, mantendo só a remoção por chave.
- **O texto que a remoção varre pode vir do atacante.** O cliente loga corpo de
  request, header, mensagem de erro de terceiro. Um regex com retrocesso
  catastrófico ali travaria o app do cliente — o oposto do princípio "o SDK
  nunca atrapalha quem o usa". Por isso os padrões não têm quantificador
  aninhado, e as classes de caractere excluem o delimitador que vem depois
  delas, que é o que impede o retrocesso. Medido no artefato construído: menos
  de 1 ms para uma mensagem de 16 KB em sete entradas hostis.
  **A medição está num teste, mas o teste tem um limite conhecido:** regex é
  síncrono, então um caso verdadeiramente catastrófico *trava* o processo em vez
  de estourar o orçamento de tempo e falhar. O teste pega regressão lenta de
  forma limpa; a exponencial ele pega travando o CI, o que bloqueia o merge, mas
  sem dizer o porquê. Não há como limitar um regex síncrono de dentro da mesma
  thread; o que resta é revisar padrão novo antes de ele entrar.

## Alternativas consideradas

- **Remoção antes do `beforeSend`** (ordem do Sentry, que roda o `beforeSend`
  por último). Descartada: entrega ao gancho o poder de republicar o que a
  plataforma acabou de tirar. Num produto que promete LGPD por padrão, a
  garantia não pode depender de o usuário não ter escrito o gancho errado.
- **Remover dos dois lados do gancho.** Dá as duas coisas, ao custo de dobrar a
  varredura de regex no caminho quente. Descartada por preço, não por ideia.
- **Amostrar por evento, com sorteio independente.** É o mais simples e o mais
  inútil: metade dos logs de uma request deixa um rastro que não conta a
  história toda. O hash do trace custa uma passada pela string.
- **Amostrar tudo, erro inclusive, sem piso.** Descartada como *padrão*, não como
  possibilidade — `alwaysFrom: false` continua lá. O padrão não pode ser aquele
  que quebra alerta em silêncio.
- **Confiar no retorno do `beforeSend`.** Descartada: o teste de contrato garante
  que a ingestão nunca rejeita o que este pacote produz, e um gancho com um
  nível inválido quebraria essa garantia sem ninguém notar até a API responder
  `400`.
- **Detectar e-mail como dado sensível.** Descartada: e-mail é frequentemente o
  assunto legítimo do log ("convite enviado para…"), e não está na lista da
  seção 8. Quem precisar põe em `privacy.extraPatterns`.
