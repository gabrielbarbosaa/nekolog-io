# ADR 0015 — Fingerprint de erro calculado na ingestão

- **Status:** aceita
- **Data:** 2026-10-31
- **Plano:** seções 3 (princípio 1), 6 e 7
- **Especificação:** 5 (fingerprint de erros)
- **Relacionada:** [0005](0005-ingestao-hono-em-workers.md) (ingestão em Workers)

## Contexto

A documentação se contradizia, e a contradição só apareceria na etapa 4.5, com
a tabela `logs` já em produção.

Três lugares diziam que o fingerprint é calculado **na ingestão**: a
especificação 5 ("calculado na ingestão para eventos com `error` ou com nível
`error` ou `fatal`"), a especificação 1 (lista `fingerprint (calculado)` entre o
que o servidor acrescenta) e a etapa 4.5 do ETAPAS ("fingerprint dos erros na
ingestão").

Um lugar dizia o contrário: o princípio 1 da seção 3 do plano, que era
"Ingestão leve, processamento pesado fora dela. A API só valida e grava.
**Agrupamento de erros**, source maps e alertas rodam em outro lugar".

A coluna `fingerprint UInt64` existe na tabela `logs` desde a etapa 1.2 e é
gravada como `0` desde a 1.9 (`UNRESOLVED_FINGERPRINT`). Então a decisão não é
só editorial: ela determina quem preenche aquela coluna, e quando.

## Decisão

**O fingerprint é calculado na ingestão**, como as especificações já diziam. O
princípio 1 foi reescrito para dizer o que ele de fato protege:

> **Ingestão sem I/O, processamento pesado fora dela.** A API valida, calcula o
> que sai do próprio evento e grava. O que precisa de rede ou de banco —
> resolver source map, avaliar regra de alerta, montar issue — roda nos jobs.

A fronteira passa a ser **I/O, não esforço**. Fingerprint é uma normalização por
regex de no máximo cinco frames mais um SHA-256: não consulta nada, não espera
nada, e trabalha sobre bytes que já estão na memória do Worker.

## Consequências

- **A coluna `fingerprint` é escrita no insert**, junto com o resto da linha.
  Não existe estado "linha gravada, fingerprint pendente", nem job de backfill.
- **A contingência do R2 continua coerente.** O `@internal/spool` guarda a linha
  já montada; se o fingerprint fosse calculado depois, um lote reenviado pelos
  jobs teria que passar por um caminho diferente do lote normal — duas receitas
  para a mesma linha, que é exatamente como se criam divergências sutis.
- **Mudar o algoritmo não reescreve o passado.** Por isso ele tem versão
  (`fingerprint_v1`, especificação 5): issue antiga não se mistura com nova. O
  custo é assumido: linha gravada com a versão antiga fica com a versão antiga.
- **Gasta CPU no caminho quente**, e o Worker gratuito tem 10 ms. O gasto é
  limitado por desenho: só para evento com `error` ou nível `error`/`fatal`, e o
  passo caro (stack trace) olha no máximo cinco frames. Num lote de 500 eventos
  de `info`, o custo é zero.
- **Regex sobre texto que vem do cliente, de novo.** Vale aqui a mesma regra da
  ADR [0014](0014-ordem-do-pipeline-de-privacidade-do-sdk.md): sem quantificador
  aninhado, porque um retrocesso catastrófico na normalização travaria a
  ingestão — e dessa vez não o app do cliente, mas a nossa.
- **O princípio 1 ficou menos slogan e mais regra.** "Ingestão leve" não dizia
  onde é a fronteira; "sem I/O" diz. Qualquer feature futura responde sozinha:
  precisa de rede ou de banco, vai para os jobs.

## Alternativas consideradas

- **Calcular nos jobs e preencher a coluna depois.** Exigiria
  `ALTER TABLE … UPDATE` no ClickHouse, que é uma *mutation*: reescreve partes
  inteiras, roda em segundo plano e não tem transação. Fazer isso de minuto em
  minuto, sobre a tabela mais quente do sistema, é a receita documentada para
  derrubar um ClickHouse. Descartada por isso, não pela ideia.
- **Calcular nos jobs e deixar `logs.fingerprint` em `0` para sempre**, com uma
  tabela `issues` separada alimentada pelos jobs. É uma arquitetura defensável —
  e é como o agrupamento provavelmente vai evoluir no M4, com source map. Mas
  hoje ela troca um `JOIN` por consulta no Explorer por uma coluna já pronta,
  e obrigaria a remover a coluna que a migration 0001 já criou. Fica como
  evolução possível, não como ponto de partida.
- **Calcular no SDK.** Descartada: o fingerprint decide o agrupamento que o
  cliente vê, e deixá-lo numa biblioteca que roda na máquina de terceiros
  significa que duas versões do SDK agrupam diferente o mesmo erro. O campo
  `fingerprint` manual do payload continua existindo justamente para quem quiser
  mandar o agrupamento pronto — é opção dele, não padrão nosso.
- **Manter o princípio 1 como estava e mudar as três especificações.** Era a
  outra saída coerente. Descartada porque o princípio era o texto mais antigo e
  mais vago dos quatro, e porque a razão técnica (a *mutation*) aponta para o
  outro lado.
