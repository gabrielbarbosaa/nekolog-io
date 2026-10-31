# @apps/jobs

O Worker agendado do NekoLog. Um único cron por ambiente acorda este app a cada
minuto e ele decide quais tarefas rodam naquele minuto.

Nesta etapa (1.10) existe só o despachante. As tarefas de verdade chegam depois:
reenvio da contingência do R2 (1.11), bloqueio por cota (1.12), *heartbeat* e
alertas de infraestrutura (2.24) e as regras de alerta (5.1).

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

Não há teste de integração aqui ainda porque não há tarefa que fale com serviço
externo. Quando a 1.11 chegar, o reenvio da contingência é testado contra o
Garage e o ClickHouse de verdade, como manda a filosofia de testes do projeto.
