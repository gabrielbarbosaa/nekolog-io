# @apps/jobs

O Worker agendado do NekoLog. Um único cron por ambiente acorda este app a cada
minuto e ele decide quais tarefas rodam naquele minuto.

Tarefas registradas hoje: **`spool-resend`** (1.11) e **`quota-block`** (1.12).
Faltam o *heartbeat* e os alertas de infraestrutura (2.24) e as regras de
alerta (5.1).

## Bindings

| Binding | Para quê |
|---|---|
| `KEYS` (KV, escrita) | onde o `quota-block` grava o bloqueio que a ingestão lê |
| `SPOOL` (R2) | a contingência que o `spool-resend` esvazia |
| `CLICKHOUSE_URL`, `CLICKHOUSE_DB` | destino do reenvio e origem do uso |
| `CLICKHOUSE_JOBS_USER`, `CLICKHOUSE_JOBS_PASSWORD` | credencial dos jobs |
| `DAILY_EVENT_QUOTA` | cota diária por ambiente; o padrão vale se não for definida |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | só quando o ClickHouse está atrás do Access |
| `JOBS_VERSION` | aparece no `/health` |

Faltando qualquer um dos obrigatórios, o Worker não sobe e diz todos os que
faltam de uma vez. Um `DAILY_EVENT_QUOTA` que não seja um inteiro positivo
também impede o boot, em vez de virar um padrão silencioso.

## `spool-resend`

Roda a cada minuto. Pega os arquivos mais antigos de `spool/` (50 por vez, para
caber no tique), reenvia cada um com o token de deduplicação gravado no próprio
arquivo e só então apaga.

- **Insert primeiro, `delete` depois.** Se o `delete` falhar, o arquivo volta no
  minuto seguinte e o token faz o ClickHouse gravar uma vez só. A ordem
  contrária perderia o lote numa falha de rede.
- **Para no primeiro erro que pode passar.** Se o ClickHouse está fora, os
  outros 49 arquivos vão falhar igual: insistir só queima o orçamento do tique.
  A varredura para e volta no minuto seguinte.
- **Não para no erro que nunca vai passar.** Um `400` do ClickHouse significa
  que aqueles bytes nunca serão aceitos (coluna que não existe, por exemplo).
  Esse arquivo vai para `quarantine/` e a varredura continua — senão um único
  lote envenenado travaria a fila para sempre. Qualquer outro código
  (`403`, `5xx`, falha de rede) é tratado como temporário: credencial errada e
  servidor fora voltam a funcionar, e quarentenar tudo nesses casos seria pior
  que esperar.
- **Também vão para a quarentena** o arquivo que não dá para ler, a chave que
  não é uma chave de spool e o lote mais velho que a janela de retenção (7
  dias), que o TTL apagaria assim que fosse gravado.
- **Quarentena é cópia e só depois remoção.** Se a cópia falhar, o arquivo fica
  onde está.

O que cada execução fez aparece no `detail` do resumo:
`{ resent, rows, quarantined, undeleted, stopped }`.

Nada apaga a `quarantine/` sozinho — é o operador que olha (runbook de
incidente) e decide. O alerta de acúmulo é a etapa 2.24.

## `quota-block`

Roda a cada minuto. Soma o uso do dia de cada ambiente, compara com a cota e
mantém no KV a lista de quem está bloqueado. A ingestão lê essa lista e passa a
responder `429 quota_exceeded`.

**O uso é contado por `received_at`, não por `timestamp`.** O `timestamp` de um
evento é escolhido por quem envia: um cliente que mandasse tudo datado de ontem
nunca apareceria na contagem de hoje e a cota não valeria nada. Por isso existe
a `usage_per_minute`, agrupada pelo horário em que o lote **chegou**, que é do
servidor. A `logs_per_minute` continua agrupada por `timestamp` — ela responde
"quando isso aconteceu", que é a pergunta certa para os gráficos.

- **Só grava no KV quando o conjunto de bloqueados muda.** O plano gratuito dá
  1.000 escritas por dia e o cron acorda 1.440 vezes; gravar todo minuto
  estouraria sozinho. Pelo mesmo motivo tudo cabe num documento só
  (`quota:blocks`) em vez de uma chave por ambiente: listar prefixo no KV custa
  uma operação de *list*, e o limite dessas é 1.000 por dia.
- **O `blockedAt` é de quando bloqueou**, não do último minuto em que continuou
  bloqueado — é o que serve para explicar o incidente depois.
- **Se não consegue medir, não mexe em nada.** Com o ClickHouse fora, a consulta
  falha e a tarefa volta sem tocar no KV. O contrário — tratar "não sei" como
  "ninguém passou da cota" — desbloquearia todo mundo exatamente durante uma
  queda.
- **Desbloqueio é automático.** Virado o dia UTC, o uso recomeça do zero, o
  ambiente deixa de aparecer acima da cota e sai da lista. Um ambiente que ficou
  calado o dia inteiro também sai, porque nem aparece na contagem.

Quem cuida da cota é esta tarefa; a `blocked` que já existia no registro da key
continua sendo a revogação manual, decidida pelo dashboard. São duas coisas
diferentes com a mesma resposta.

A cota é **por ambiente**. O plano fala em cota por organização, e é isso que
vai valer quando o `internal/db` existir (M2): a tarefa já aceita um
`quotaFor(environmentId)` no lugar do valor fixo, que é onde a soma por
organização vai entrar. Inventar uma organização agora, sem banco que a guarde,
seria pior que o recorte menor.

O que cada execução fez aparece no `detail` do resumo:
`{ environments, blocked, unblocked, stillBlocked, written, stopped }`.

## Por que um cron só

O Cloudflare dá **5 Cron Triggers por conta** e o NekoLog tem três ambientes
(`dev`, `qa` e `prod`). Se cada tarefa tivesse o seu cron, o orçamento acabaria
na terceira tarefa do primeiro ambiente. Então é um cron por ambiente, de minuto
em minuto, e a cadência de cada tarefa é decidida aqui dentro.

## Como a cadência é decidida

Um Worker não tem memória entre execuções: o *isolate* que rodou o minuto
passado pode já não existir. Guardar "quando rodei pela última vez" numa
variável daria certo no `pnpm dev` e erraria em produção, de um jeito difícil de
perceber.

Por isso a decisão é **aritmética sobre o horário agendado**, não um estado:

```
minuto = floor(scheduledTime / 60000)
roda se (minuto - offsetMinutes) % everyMinutes === 0
```

A mesma entrada dá sempre a mesma resposta, em qualquer isolate, em qualquer
réplica. `everyMinutes: 5` cai em `:00`, `:05`, `:10`…; `everyMinutes: 60` cai no
minuto `:00` de cada hora, em UTC.

O `offsetMinutes` existe para duas tarefas de mesma cadência não caírem no mesmo
tique — `{ every: 5 }` e `{ every: 5, offset: 2 }` nunca se encontram.

**O que isso custa:** se o Cloudflare atrasar ou pular um tique (ele pode, e não
garante entrega), a tarefa daquele minuto não roda — ela espera o próximo slot
dela. Para `everyMinutes: 1` isso é um minuto perdido; para uma tarefa horária é
uma hora. Tarefa que não pode perder um ciclo precisa ser idempotente e olhar
para trás (é o caso do reenvio da contingência, que varre o que ficou no R2).

## O que o despachante garante

- **Uma tarefa que quebra não derruba as outras.** Cada uma roda isolada e vira
  uma linha do resumo com `ok`, `failed` ou `timed_out`. `runDueTasks` nunca
  rejeita.
- **Tarefa travada não segura o resto.** Cada uma tem um prazo
  (`timeoutMs`, 25 s por padrão), limitado pelo orçamento do tique inteiro
  (`budgetMs`, 50 s) — assim uma execução termina antes do próximo minuto. Ao
  estourar o prazo, o `AbortSignal` da tarefa é abortado, então um `fetch` feito
  com ele é cancelado de verdade em vez de ficar rodando sozinho.
- **As tarefas rodam em paralelo.** São todas de E/S (ClickHouse, KV, R2,
  Resend); em série, a mais lenta atrasaria todas as outras dentro do mesmo
  orçamento.
- **O resumo é uma linha só de JSON**, com o que rodou, o que foi pulado, quanto
  demorou e quantas falharam. É nisso que o monitoramento da 2.24 vai se apoiar.
- **O cron fica vermelho quando algo falha.** O `scheduled` lança depois de
  registrar o resumo, porque o painel de Cron Events do Cloudflare é a única
  visibilidade que existe antes da 2.24; um resumo com falhas e execução verde
  seria pior que nada.

## `/health`

```
GET /health → { status, service, version, tasks }
```

`tasks` é a **quantidade** de tarefas registradas, não os nomes: serve para
conferir que o deploy registrou o que devia, sem listar o que roda por dentro.

**Não existe rota que dispare tarefa.** Um endpoint desses seria um gatilho de
job sem autenticação na borda pública, e há um teste que falha se alguém
adicionar um.

`/health` **não informa a última execução**, de propósito. Em Workers, o isolate
que responde ao `/health` quase nunca é o que rodou o cron, então ele responderia
"nunca executei" estando tudo certo — um monitor externo veria isso como queda. A
prova de vida vem do próprio cron (2.24), não daqui.

## Self-host

O mesmo despachante roda fora do Cloudflare pelo `startScheduler`, que alinha os
tiques ao minuto cheio do relógio, reagenda a cada volta (em vez de confiar num
`setInterval`, que acumula atraso) e **não começa uma execução enquanto a
anterior não terminou** — proteção que o Cloudflare não oferece e que aqui é
possível porque o processo é longo.

Ele arredonda `Date.now()` para o minuto mais próximo antes de decidir a
cadência: um timer que dispara 2 ms adiantado não pode ser interpretado como o
minuto anterior.

O container de self-host (processo, `/health` em Node e `Dockerfile`) ainda não
existe — vem junto com o empacotamento dos apps.

## Testes

```bash
pnpm --filter @apps/jobs test
```

`tests/spool.integration.test.ts` roda contra um ClickHouse **de verdade**: ele
manda um lote para a ingestão com o ClickHouse fora do ar, confere que o lote
ficou na contingência, reenvia, e confere que a linha apareceu — e que reenviar
o mesmo arquivo de novo não duplica. É por isso que `@apps/ingest` está aqui
como dependência de desenvolvimento: o que não pode divergir é o formato que um
grava e o outro lê, e o jeito de garantir isso é usar os dois no mesmo teste.

`tests/quota.integration.test.ts` faz o mesmo com a cota: manda lotes de
verdade pela ingestão, confere que um evento datado de 2020 **entra na contagem
de hoje** (e não entra na dos gráficos), roda a varredura, e confere que a
mesma API passa a responder `429 quota_exceeded` — e volta a aceitar quando a
cota sobe.

Sem um ClickHouse acessível esses testes são pulados, com aviso no stderr; no
CI, `CLICKHOUSE_TEST_REQUIRED=1` transforma o skip em erro.

## Deploy

Um Worker por ambiente — `nekolog-jobs-dev`, `-qa` e `-prod` — publicados pelo
workflow `Workers` no merge da branch correspondente. Os bindings vêm do
`wrangler.json`, com os valores da conta preenchidos na hora pelo
[`@internal/deploy`](../../internal/deploy/README.md); as senhas sobem separadas,
com `wrangler secret bulk`.

**Este Worker não tem endereço.** Nenhuma rota, nenhum `workers.dev`, nenhuma
URL de preview. Ele só é acordado pelo cron `* * * * *`, que é a cadência que o
despachante assume. O `/health` existe para o self-host, onde o app roda como um
processo comum; na Cloudflare ele é inalcançável de propósito, e
`src/wrangler.test.ts` falha se alguém der um hostname a ele — é a mesma
preocupação da ameaça E12, um degrau antes: lá o app não expõe rota que rode
tarefa, aqui ele não expõe rota nenhuma.
