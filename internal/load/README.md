# @internal/load

```bash
pnpm load ingest --vus 10 --duration 30s --events 200 --service load-run-1
pnpm load api    --vus 10 --duration 30s
```

Teste de carga com [k6](https://k6.io). Usa o binário se ele estiver instalado,
senão sobe a imagem `grafana/k6` no Docker — nenhuma das duas precisa estar
presente para o `pnpm test` passar.

| | |
|---|---|
| `--url <url>` | onde o alvo responde (padrão: ingest `:8787`, api `:8789`) |
| `--key <key>` | a key a mandar (padrão `$NEKOLOG_KEY`) |
| `--vus <n>` | usuários virtuais |
| `--duration <t>` | quanto tempo |
| `--events <n>` | eventos por lote, só na ingestão |
| `--service <nome>` | como o lote se chama, para contar uma corrida separado |
| `--runner <r>` | `k6` ou `docker` |

Antes de medir qualquer coisa ele bate em `/health` e recusa a corrida se nada
responder — um alvo desligado produz 100% de erro, que não é uma medição.

## O número que manda

**Um Worker no plano gratuito tem ~10 ms de CPU por request** (seção 4 do
plano). O k6 não enxerga isso: ele mede latência de ponta a ponta, e 10 ms de
CPU se escondem atrás de qualquer espera de rede. Por isso o orçamento de CPU
é medido num teste, em `apps/ingest/src/budget.test.ts`, e o k6 mede o resto.

## O que foi medido (2026-11-04)

Numa máquina só, Node 24, ClickHouse em Docker ao lado. Não é hardware da
Cloudflare — serve para ordem de grandeza e para pegar regressão, não como
promessa de produção.

**CPU por request na ingestão**, pior lote legal (500 eventos, 20% erros todos
distintos, gzip, todas as regras de redação ligadas):

| | antes | depois |
|---|---|---|
| lote de 500 | **10,8 ms** | **9,1 ms** |
| `rowsFor` | 3,5 ms | 1,5 ms |
| 100 digests SHA-256 | 1,2 ms | ~0 quando o erro se repete |

O "depois" é a memoização do fingerprint por lote. O orçamento é 10 ms: mesmo
depois, **não sobra folga** no lote máximo. É por isso que o padrão do SDK
passou a ser 200 eventos por lote (`DEFAULT_MAX_BATCH_EVENTS`), que custa
~2,1 ms — o limite do protocolo continua 500 para quem pedir.

**Vazão, 10 VUs por 30 s, lotes de 200 eventos:**

| | ingestão | API pública |
|---|---|---|
| requests/s | 44 | 842 |
| eventos/s | **8.920** | — |
| p95 | 262 ms | 20 ms |
| falhas | 0 | 0 |

A latência da ingestão aqui é quase toda a escrita no ClickHouse: a entrada
Node espera o insert, enquanto no Worker ela sai pelo `waitUntil`.

**Perda: zero.** 1.338 lotes × 200 eventos = 267.600 aceitos, e 267.600 linhas
no ClickHouse. Vale conferir isso sempre:

```sql
SELECT service, count() FROM nekolog_dev.logs GROUP BY service
```

## Duas coisas que a primeira corrida ensinou

**O limitador de taxa aparece antes de qualquer gargalo.** Com o padrão de
2.000 eventos/minuto por ambiente, 10 VUs mandando 200 eventos estouram a
janela em dez requests. Isso é o sistema funcionando, então o script conta
`429` como resultado medido — e confere que ele traz `Retry-After` — em vez de
chamar de falha. Para medir vazão de verdade, suba `INGEST_EVENTS_PER_MINUTE`
(ou `API_REQUESTS_PER_MINUTE`) antes de iniciar o alvo.

**Um `batchId` repetido mede o nada.** A primeira corrida aceitou 259.600
eventos e gravou **200 linhas**: o k6 mandava o mesmo lote de novo, e a
deduplicação do ClickHouse (`<environmentId>:<batchId>`) descartava todos os
outros. A ingestão estava certa; o teste é que estava errado. O script agora
troca o `batchId` a cada iteração — e a conferência de linhas é o que mostrou
isso, não o relatório do k6.

## Os limiares

Vêm de `src/budget.ts`, e o `budget.test.ts` lê o `docs/PLANO.md` e falha se os
números da plataforma saírem de lá. O p95 e a taxa de falha são alvos
escolhidos aqui, não números documentados; estão em um lugar só e o k6 recebe
por variável de ambiente.
