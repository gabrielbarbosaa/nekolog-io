# Runbook — Incidente

> Ponto de entrada para qualquer coisa fora do ar, lenta ou estranha.
> Leia o [aviso sobre o estado dos runbooks](README.md#estado-destes-runbooks).

**Tudo roda numa máquina só.** Isso simplifica o diagnóstico — há um lugar para
olhar — e piora a consequência: um disco cheio derruba a ingestão, a API, os
jobs e os dois sites ao mesmo tempo.

## 1. Estabilizar antes de entender

A ordem importa. Primeiro reduzir o dano, depois descobrir a causa.

1. **Confirme que é real.** Tente você mesmo, de fora:
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://ingest.«dominio»/health
   curl -sS -o /dev/null -w '%{http_code}\n' https://api.«dominio»/health
   curl -sS -o /dev/null -w '%{http_code}\n' https://«dominio»/
   ```
   Alerta sozinho pode ser falso positivo do próprio monitor.
2. **Separe a máquina do caminho até ela.** Se o `curl` não chega, entre por SSH
   e repita contra a loopback — `curl localhost:8787/health`, `:8789`, `:8788`.
   Responde por dentro e não por fora: o problema é Caddy, DNS ou proxy
   ([§3.1](#31-não-chega-na-máquina)), não a aplicação.
3. **Anote a hora de início** e o que você observou. Você vai precisar disso
   depois e não vai lembrar.

## 2. Qual peça caiu

Na máquina, sempre comece pelo mesmo par de comandos:

```bash
cd «clone»/deploy/self-host
docker compose ps
df -h /
```

`docker compose ps` diz quem não está de pé; `df -h` responde a causa mais
provável de tudo o que é estranho aqui. O container `bootstrap` **sai** depois
de migrar — vê-lo parado é o esperado, não um sintoma.

| Sintoma | Peça provável | Vá para |
|---|---|---|
| Nada responde de fora, tudo responde por dentro | Caddy, DNS ou certificado | [§3.1](#31-não-chega-na-máquina) |
| Ingestão retornando erro | `ingest` ou ClickHouse | [§3.2](#32-ingestão-falhando) |
| Tudo ok mas sem logs novos aparecendo | ClickHouse ou contingência | [§3.3](#33-logs-não-aparecem) |
| A API de leitura responde 503 | ClickHouse ou Postgres | [§3.4](#34-a-api-de-leitura-responde-503) |
| Alertas pararam de disparar | container `jobs` | [§3.5](#35-jobs-parados) |
| A máquina inteira lenta | memória ou disco | [§3.6](#36-a-máquina-inteira-está-lenta) |
| Suspeita de acesso indevido | — | **Pare e vá para [§5](#5-se-for-incidente-de-segurança)** |

## 3. Diagnóstico por peça

### 3.1 Não chega na máquina

1. **DNS.** `dig +short ingest.«dominio»` tem que devolver um endereço do
   Cloudflare (o registro é *proxied*), não o da máquina. Os registros são
   declarados em [`infra/vps`](../../infra/vps); se algum sumiu, foi um `apply`.
2. **Certificado.** O Caddy pede um por nome ao Let's Encrypt. Um nome novo sem
   registro A nunca consegue certificado, e o erro aparece no log do proxy:
   ```bash
   docker compose logs --tail 50 proxy
   ```
   `ACME_EMAIL` existe justamente para que a expiração não chegue calada.
3. **O proxy está de pé?** É o único container que publica porta para fora
   (80 e 443). Todos os outros estão na loopback de propósito.

### 3.2 Ingestão falhando

1. Qual código de erro os clientes recebem? `429` é limite ou cota, `401`/`403`
   é key, `413` é batch grande demais, `5xx` é a plataforma.
2. `429`: pode ser o freio de rajada (`INGEST_EVENTS_PER_MINUTE`, por ambiente)
   ou a cota diária (`DAILY_EVENT_QUOTA`, aplicada pelos jobs através da lista
   de bloqueio). A lista fica no volume `nekolog_kv`, escrita **só** pelo
   container `jobs`:
   ```bash
   docker compose exec jobs cat /var/lib/nekolog/kv/quota:blocks
   ```
3. `401`/`403` logo depois de mexer nas keys: a ingestão lê
   `.nekolog-seed.json` e **relê o arquivo sozinha**, sem reiniciar. Se a key
   nova não passa a valer, o problema é o arquivo, não o cache.
4. ClickHouse inalcançável: veja [§3.3](#33-logs-não-aparecem). A ingestão
   **deve** continuar respondendo `202` e mandando para a contingência — se ela
   estiver retornando `5xx` com o ClickHouse fora, isso é um bug, não só um
   incidente.

### 3.3 Logs não aparecem

1. O ClickHouse está rodando? `docker compose ps clickhouse`.
2. **Disco cheio** é a causa mais provável de um ClickHouse que para de aceitar
   insert. `df -h /`. Se estiver cheio:
   - confirme que o TTL está removendo partições antigas:
     ```sql
     SELECT partition, sum(rows), formatReadableSize(sum(bytes_on_disk))
     FROM system.parts WHERE active AND table = 'logs'
     GROUP BY partition ORDER BY partition
     ```
   - considere reduzir o `retention_days` dos ambientes;
   - veja [§3.6](#36-a-máquina-inteira-está-lenta) antes de apagar qualquer
     coisa à mão.
3. **Memória**, não disco: o ClickHouse tem teto próprio em
   `clickhouse-limits.xml`, deliberadamente abaixo do `mem_limit` do container,
   para que uma consulta cara seja **recusada** em vez de o processo ser morto
   pelo kernel. Um `Memory limit exceeded` no log é esse desenho funcionando.
4. Confira quanto acumulou na contingência — isso diz há quanto tempo o
   problema existe e quanto os jobs vão precisar reenviar:
   ```bash
   docker compose exec jobs ls -la /var/lib/nekolog/spool
   ```

### 3.4 A API de leitura responde 503

`503 upstream_unavailable` é sempre a mesma frase, de propósito: a exceção real
pode citar uma coluna ou um valor, então ela vai para o log e não para a
resposta.

```bash
docker compose logs --tail 50 api
```

São dois bancos. ClickHouse serve `/v1/logs` e `/v1/histogram`; Postgres serve
`/v1/issues`. Uma API que responde a dois terços das rotas é o Postgres.

### 3.5 Jobs parados

Com os jobs parados: alertas não disparam, cotas não são aplicadas, a
contingência não é reenviada e não há backup do ClickHouse. **Nada quebra
visivelmente**, e é justamente por isso que existe um heartbeat.

1. O `HEARTBEAT_URL` é pingado a cada execução bem-sucedida, e em
   `…/fail` depois de uma que falhou — um cron morto e uma tarefa quebrada são
   sinais diferentes. Se `HEARTBEAT_URL` está vazio, **não há esse sinal**: o
   monitor externo é o item B12 e ainda não existe.
2. `docker compose logs --tail 100 jobs`. O agendador é interno ao processo, de
   um minuto; não há cron do sistema para conferir.
3. O container `jobs` **não expõe nenhuma rota que execute tarefa** — só
   `/health`. Se você está procurando um `/run` para forçar uma execução, ele
   não existe, e há um teste que falha se alguém o adicionar.

### 3.6 A máquina inteira está lenta

São dez containers em 1 vCPU. Cada um tem teto de memória no compose, somados
para caber numa máquina de 4 GB.

```bash
docker stats --no-stream
free -h
df -h /
docker system df
```

Três causas, em ordem de probabilidade: ClickHouse fazendo merge depois de um
pico; imagens e volumes antigos ocupando disco (`docker image prune` é seguro,
`docker volume prune` **não é** — os dados moram em volumes); e um build de
deploy rodando ao lado do ClickHouse, que é a hora mais cara do dia nesta
máquina.

## 4. Comunicação

- Incidente que afeta usuários: diga alguma coisa. Mesmo "estamos investigando"
  é melhor que silêncio. Não há página de status ainda.
- Dado de terceiro exposto: há obrigação de notificação sob a LGPD. Vá para
  [§5](#5-se-for-incidente-de-segurança).

## 5. Se for incidente de segurança

**Não apague nada.** Log, sessão e registro de acesso são a evidência.

1. **Contenha**: revogue o que for necessário (key, senha, token). Runbooks
   específicos: [vazamento de key](vazamento-de-key.md),
   [rotação de segredos](rotacao-de-segredos.md).
2. **Preserve**: exporte o `audit_log` do período e os logs relevantes antes que
   a retenção os apague. Copie para fora da máquina — se o acesso foi à própria
   máquina, a evidência está no alcance de quem entrou.
3. **Avalie o alcance**: que dado pôde ser acessado, de quem, por quanto tempo.
   Acesso de root à máquina é alcance total: o `.env` com todas as senhas está
   lá, e com ele todos os logs de todos os clientes.
4. **Notifique** quem foi afetado. Sob a LGPD, vazamento de dado pessoal tem
   dever de comunicação ao titular e à ANPD.
5. Se veio por reporte externo, responda pelo canal do
   [SECURITY.md](../../SECURITY.md) e combine a divulgação com quem reportou.

## 6. Reverter um deploy

O deploy é `git pull` na máquina, e a volta é à mão — por isso
[`deploy.sh`](../../deploy/self-host/deploy.sh) imprime o comando de volta
**antes e depois**:

```
deploy: roll back with: git -C /srv/nekolog checkout 408e8c6 && …/deploy.sh
```

Um build que falha não troca nada do que está rodando. Um build que passa com
código ruim troca — é para isso que a linha acima serve.

## 7. Depois

1. Escreva o que aconteceu: linha do tempo, causa, o que atrasou a resolução.
2. **Atualize este runbook** com o que estava errado ou faltando.
3. Se a causa revelou uma ameaça não prevista, adicione ao
   [modelo de ameaças](../security/threat-model.md).
4. Vire as correções em etapas do [ETAPAS.md](../ETAPAS.md), não em boas
   intenções.
