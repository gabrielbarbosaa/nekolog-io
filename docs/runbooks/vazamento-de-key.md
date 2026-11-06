# Runbook — Vazamento de key

> Leia o [aviso sobre o estado dos runbooks](README.md#estado-destes-runbooks).

Duas situações muito diferentes com o mesmo nome. Identifique qual é antes de
agir.

| | Key de cliente (`nekolog_sk_…`) | Credencial da plataforma |
|---|---|---|
| **Exemplo** | `sk` commitada num repositório público | `CLICKHOUSE_INSERT_PASSWORD`, `ENCRYPTION_KEY`, credencial do bucket de backup |
| **Alcance** | Um ambiente de um projeto | Toda a plataforma |
| **Vá para** | [§1](#1-key-de-cliente) | [§2](#2-credencial-da-plataforma) |

---

## 1. Key de cliente

### 1.1 Conter (minutos, não horas)

**Não existe botão de revogar.** O dashboard é item B7 e não roda nesta máquina;
hoje as keys moram no documento do seed, e revogar é tirar o hash de lá:

1. **Crie a key nova primeiro**, para não derrubar a aplicação do cliente entre
   a revogação e a troca:
   ```bash
   docker compose run --rm --entrypoint sh bootstrap \
     -c 'pnpm seed add-key --file $SEED_FILE --environment «ambiente»'
   ```
   A key aparece **uma vez** na saída; o documento guarda só o hash.
2. **Entregue a key nova** a quem precisa e espere a aplicação do cliente trocar.
3. **Tire a entrada vazada** do `.nekolog-seed.json` (o objeto da key, pelo
   `hash`). A ingestão **relê o arquivo sozinha**, sem reiniciar — esse é o
   mecanismo, e dá para conferir que valeu mandando um log com a key antiga e
   recebendo `401`.
4. Leve a mudança para o Postgres também, ou o rollup de issues e os alertas
   continuam vendo a key antiga:
   ```bash
   docker compose run --rm --entrypoint sh bootstrap \
     -c 'pnpm seed sync-db --file $SEED_FILE'
   ```

> **Isto é uma lacuna, não um procedimento.** Editar JSON à mão sob pressão é
> exatamente o que um runbook deveria evitar. Um `pnpm seed revoke` resolveria,
> e não existe; registre como achado se este runbook for usado de verdade.

### 1.2 Avaliar o alcance

O que a key permitia depende do tipo e do escopo:

- **`pk` (pública):** só escreve. O dano possível é log falso e consumo de
  cota. Confira o volume do ambiente no período e se a lista de origens
  permitidas estava configurada — se estava, o alcance real foi bem menor.
- **`sk` com `logs:write`:** idem, sem a proteção de origem. Também permite
  registrar release e subir source map (`POST /v1/releases`, `/v1/sourcemaps`).
- **`sk` com `logs:read`:** **pôde ler os logs daquele ambiente.** Esse é o caso
  grave. Trate como vazamento de dado: siga o
  [runbook de incidente, §5](incidente.md#5-se-for-incidente-de-segurança).

Uma key nomeia **um** projeto e **um** ambiente, e a API de leitura usa isso
para escopar a consulta — um `?project=` do chamador não muda nada, e um `env:`
dentro da busca é recusado com `400` em vez de ignorado. O alcance de uma key de
leitura é um ambiente, nunca a plataforma.

### 1.3 Verificar o uso

1. Procure gravações anômalas no ambiente: volume fora do padrão, `service`
   desconhecido, país inesperado.
   ```sql
   SELECT service, country, count() FROM logs
   WHERE environment_id = '«id»' AND received_at > now() - INTERVAL 7 DAY
   GROUP BY service, country ORDER BY count() DESC
   ```
2. Um pico de `clock_skew_ms` alto junto com volume estranho é sinal de alguém
   reproduzindo batches antigos.
3. Registre tudo no `audit_log`.

### 1.4 Se a key foi commitada num repositório público

Revogar **não basta** — a key continua no histórico do Git e em caches de
terceiros. A key revogada é inútil, mas confirme que foi mesmo revogada antes de
considerar encerrado. Reescrever o histórico do repositório do cliente é decisão
dele, não nossa.

---

## 2. Credencial da plataforma

**Assuma comprometimento total do que aquela credencial alcança.** Não tente
estimar se "provavelmente ninguém viu".

Quase todas moram num arquivo só: `deploy/self-host/.env`, na máquina, com
permissão `0600`. Isso significa que **acesso de root à máquina compromete
todas de uma vez** — não há cofre separando uma da outra, e o endurecimento do
acesso (item B2) é o que protege esse arquivo.

### 2.1 Conter

1. **Revogue no provedor primeiro, rode a rotação depois.** Uma credencial
   revogada que ainda não foi substituída causa indisponibilidade; uma
   credencial comprometida que ainda funciona causa dano. Indisponibilidade é
   preferível.
2. Siga o [runbook de rotação de segredos](rotacao-de-segredos.md) para o
   segredo específico.

### 2.2 Por credencial

| Credencial | Alcance do comprometimento | Urgência |
|---|---|---|
| Acesso SSH à máquina | **Tudo nesta tabela de uma vez**, porque o `.env` está lá | Imediata |
| `ENCRYPTION_KEY` | Decifrar segredos de canal de alerta guardados no banco | Imediata |
| `POSTGRES_PASSWORD` / `DATABASE_URL` | Todos os metadados: orgs, projetos, keys (hashes), alertas, audit log | Imediata |
| `CLICKHOUSE_READ_PASSWORD` | Ler **todos os logs de todos os clientes** | Imediata |
| `CLICKHOUSE_DEFAULT_PASSWORD` | É quem restaura backup: alcance total no ClickHouse | Imediata |
| `CLICKHOUSE_MIGRATOR_PASSWORD` | DDL: apagar ou alterar tabela | Imediata |
| `CLICKHOUSE_INSERT_PASSWORD` | Gravar logs falsos | Alta |
| `CLICKHOUSE_JOBS_PASSWORD` | Ler logs e **escrever** exportação no S3 | Alta |
| `CLICKHOUSE_BACKUP_PASSWORD` | Mandar backup para outro lugar. Não lê linha nenhuma | Média |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | Ler **todos os backups do ClickHouse** e apagá-los | Imediata |
| `CLOUDFLARE_API_TOKEN` | Reapontar o DNS: interceptar todo o tráfego | Imediata |
| `INFRA_GITHUB_TOKEN` | Reescrever as proteções de branch deste repositório | Alta |
| `TF_ENCRYPTION` | Decifrar o estado do OpenTofu → os segredos de infraestrutura de uma vez | Imediata |
| `OPS_DISCORD_WEBHOOK_URL` / `HEARTBEAT_URL` | Mandar aviso falso, ou calar o monitor fingindo sucesso | Alta |
| `RESEND_API_KEY` | Enviar e-mail como `nekolog.io` (phishing). **Não está no compose da máquina hoje** — o canal de e-mail ainda não foi ligado lá | Alta |
| `BACKUP_AGE_RECIPIENT` | Chave **pública** — vazamento é inofensivo | Nenhuma |

A metade privada da chave `age` **não está nesta tabela de propósito**: ela não
fica na máquina nem no CI. Se ela vazar junto com a credencial do bucket, os
dumps do Postgres são legíveis — é o único par que precisa estar separado para
o desenho funcionar.

### 2.3 Caso especial: credencial de publicação no npm

Não existe token de npm para vazar: a publicação usa trusted publishing (OIDC),
sem segredo guardado. **Se um pacote `@nekolog-io/*` for publicado sem ser pelo
CI**, isso é comprometimento da conta do npm ou do GitHub, não de uma
credencial:

1. Deprecate a versão maliciosa no npm imediatamente (`npm deprecate`) — não
   confie em `unpublish`, que tem janela de 72 h e pode já não ser possível.
2. Publique uma versão corrigida.
3. Avise pelo GitHub (Security Advisory) — o pacote roda **dentro da aplicação
   de terceiros**, é o maior alcance possível de dano.
4. Revise os logs de acesso do npm e do GitHub.

### 2.4 Depois

1. Confirme que a credencial antiga **realmente** não funciona mais.
2. Investigue como vazou. Se foi por um caminho que o secret scanning deveria
   ter pegado, o achado é esse — conserte o detector, não só o segredo.
3. Registre no `audit_log` e no [modelo de ameaças](../security/threat-model.md)
   se revelou uma ameaça não prevista.
