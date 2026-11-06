# Runbook — Restauração de backup

> Leia o [aviso sobre o estado dos runbooks](README.md#estado-destes-runbooks).

## O que tem backup e o que não tem

| Dado | Backup | Se perder |
|---|---|---|
| **Postgres** (orgs, projetos, ambientes, keys, issues, alertas, audit log) | `pg_dump` diário **pela própria máquina**, cifrado com `age`, no bucket sob `postgres/`, retenção de `BACKUP_KEEP_DAYS` | Restaurar. |
| **ClickHouse** (logs) | `BACKUP DATABASE` diário para o mesmo bucket, sob `clickhouse/`, se configurado | Restaurar. É o dado pelo qual o cliente paga. |
| **Volume do spool** (`nekolog_spool`) | **Nenhum** | Os batches que ainda não foram reenviados somem. Vale minutos de log, não dias. |
| **Volume do KV** (`nekolog_kv`) | **Nenhum** | A lista de bloqueio é recalculada pelos jobs no minuto seguinte. |
| **Volume dos source maps** (`nekolog_sourcemaps`) | **Nenhum** | São reenviados no próximo deploy do cliente. |
| **`.nekolog-seed.json`** (volume `nekolog_state`) | **Nenhum automático** | Ninguém consegue mandar log: a ingestão lê as keys daí. **Copie esse arquivo para fora da máquina.** |

A linha do ClickHouse dizia "nenhum, por decisão — perda aceita: logs são
descartáveis". Isso valia para um projeto de estudo e **deixou de valer no dia
em que alguém paga para guardar esses logs**. Hoje existe backup; o que não
existe é obrigação de configurá-lo, e um container de jobs sem destino avisa
isso em toda partida.

**Os dois backups vão para o mesmo bucket e têm retenções diferentes, por
mecanismos diferentes.** O do Postgres apaga os próprios arquivos antigos por
`BACKUP_KEEP_DAYS`; o do ClickHouse não apaga nada, porque o ClickHouse não sabe
apagar objeto em S3 — quem expira é uma regra de ciclo de vida declarada em
[`infra/vps`](../../infra/vps), e ela mira **só** o prefixo `clickhouse/`. Uma
regra para o bucket inteiro seria uma segunda retenção sobre os mesmos arquivos,
com outro número.

## 1. Decidir se é para restaurar

Restauração **sobrescreve dados**. Antes de começar:

1. **Qual é o dano exato?** Tabela corrompida, registro apagado por engano,
   banco inteiro perdido? Para um registro só, editar direto costuma ser melhor
   que restaurar tudo.
2. **Quanto se perde?** O backup é diário. Restaurar significa perder tudo
   depois do último dump — projetos criados, keys geradas, regras de alerta.
3. **Nunca restaure por cima do banco em produção.** Não há branch de banco para
   onde fugir como havia no provedor anterior: aqui o Postgres é um container, e
   o lugar seguro é **outro** container, ao lado, com um volume descartável.
   Confira lá, e só então troque.

## 2. Restaurar o Postgres

> Comandos não executados — conferir antes de usar em produção.

1. **Pare quem escreve**, para que a restauração não compita com os jobs:
   ```bash
   cd «clone»/deploy/self-host
   docker compose stop jobs api backup
   ```
   A ingestão continua: ela não depende do Postgres, e parar de aceitar log é um
   dano maior que o que você está consertando.
2. **Localize o dump** no bucket, sob `postgres/`, pela data desejada.
3. **Decifre com `age`.** A chave privada está **offline, com o autor** — só a
   pública (`BACKUP_AGE_RECIPIENT`) fica na máquina, justamente para que quem
   alcança a máquina e o bucket não consiga ler backup.
   ```bash
   age --decrypt -i «chave-privada» -o dump.sql.gz backup-«data».sql.gz.age
   gunzip dump.sql.gz
   ```
4. **Suba um Postgres descartável** e restaure nele primeiro:
   ```bash
   docker run --rm -d --name pg-restore -e POSTGRES_PASSWORD=restore \
     -p 15432:5432 postgres:18
   psql "postgres://postgres:restore@localhost:15432/postgres" < dump.sql
   ```
5. **Confira antes de trocar qualquer coisa.** No mínimo: contagem de
   `organizations`, `projects`, `environments` e `api_keys` bate com o esperado?
   O `audit_log` tem registro até a data do dump?
   ```sql
   SELECT 'orgs', count(*) FROM organizations
   UNION ALL SELECT 'keys', count(*) FROM api_keys
   UNION ALL SELECT 'audit', max(created_at)::text FROM audit_log
   ```
6. **Só então** restaure no banco de verdade, com o container parado e o volume
   recriado — restaurar por cima de tabelas que já existem mistura dois estados:
   ```bash
   docker compose stop postgres
   docker volume rm «projeto»_nekolog_postgres
   docker compose up -d postgres
   docker compose exec -T postgres psql -U nekolog nekolog < dump.sql
   docker compose up -d
   ```
7. Apague o container descartável: `docker rm -f pg-restore`.

## 3. Reconciliar

Restaurar o Postgres deixa o resto do sistema fora de sincronia:

- **As keys.** O Postgres tem os hashes, mas quem a ingestão lê é o
  `.nekolog-seed.json`. Keys criadas depois do dump sumiram do Postgres e
  **continuam valendo** na ingestão; keys revogadas depois voltaram a existir no
  Postgres. Ressincronize numa direção só:
  ```bash
  docker compose run --rm --entrypoint sh bootstrap \
    -c 'pnpm seed sync-db --file $SEED_FILE'
  ```
  Isso escreve o documento do seed por cima do Postgres, e é a direção certa:
  o arquivo é a verdade para a ingestão.
- **Logs no ClickHouse** referenciam `project_id` e `environment_id` que talvez
  não existam mais no Postgres. Isso aparece como log órfão, e faz o rollup de
  issues falhar com violação de chave estrangeira — o `sync-db` acima é o que
  resolve.
- **Agendamentos** (exportações, regras de alerta) voltam ao estado do dump:
  regras criadas depois precisam ser recriadas, regras apagadas voltam a
  disparar. Um alerta que estava `firing` volta a `ok` e **dispara de novo**.

## 3.5 Restaurar o ClickHouse

Cada backup é um objeto por conta própria em `clickhouse/<carimbo>` dentro do
bucket, onde o carimbo é o momento da tentativa (`2026-11-05T03-00-00Z`). Não há
cadeia incremental: **cada um é completo e independe dos outros**, então perder
um não leva os anteriores junto.

**Restaure sempre num banco novo, nunca por cima do `nekolog`.** Um `RESTORE`
por cima de uma tabela que existe falha, e insistir com `allow_non_empty_tables`
mistura o que foi restaurado com o que já estava lá.

```sql
RESTORE DATABASE nekolog AS nekolog_restaurado
FROM S3('«endpoint»/«bucket»/clickhouse/«carimbo»', '«key»', '«secret»')
```

Depois confira antes de trocar qualquer coisa de lugar:

```sql
SELECT
  (SELECT count() FROM nekolog_restaurado.logs)              AS linhas,
  (SELECT count() FROM nekolog_restaurado.usage_per_minute)  AS consumo,
  (SELECT count() FROM nekolog_restaurado._migrations)       AS migracoes
```

`usage_per_minute` é o que mede consumo para cobrança, e `_migrations` é o que
diz em qual versão de schema aquele backup estava — se as migrações do
repositório estiverem à frente, rode `pnpm ch:migrate` por cima do banco
restaurado antes de usá-lo.

**Cuidado com o disco.** Restaurar ao lado significa duas cópias do banco na
mesma máquina. Confira `df -h /` antes de começar: não cabendo, o `RESTORE`
morre no meio e você fica com um banco pela metade *e* o disco cheio.

**Quem pode restaurar não é quem faz o backup.** O `nekolog_backup` só tem
`BACKUP`, `WRITE ON S3` e leitura de `system.backups`: ele escreve a cópia e não
consegue ler uma linha de log nem trazer nada de volta. O `nekolog_migrator` não
tem acesso nenhum a S3. A restauração roda como `default`, com a senha do
`.env`, e isso é de propósito: restaurar é quebra de vidro, e nenhuma credencial
de rotina deveria conseguir fazer.

## 4. Teste de restauração (não espere o incidente)

O plano exige **teste a cada marco** (seção 15.3). Um backup nunca restaurado
não é um backup — é um arquivo.

O teste do Postgres está automatizado e é um `workflow_dispatch`:
[`backup.yml`](../../.github/workflows/backup.yml) baixa o backup mais recente,
confere o cabeçalho `age-encryption.org`, restaura num Postgres descartável e
consulta cada tabela, uma a uma. **Restaurar numa máquina diferente da que fez o
backup é a única versão desse teste que vale** — ela exercita também a chave
privada do `age`, que é o ponto de falha mais provável de todos.

O do ClickHouse ainda é à mão, e é o procedimento de [§3.5](#35-restaurar-o-clickhouse):

- [ ] O backup do dia existe sob `clickhouse/` e tem tamanho plausível.
- [ ] O `RESTORE` termina sem erro, num banco com outro nome.
- [ ] As contagens batem com a produção.
- [ ] `_migrations` está na mesma versão que o repositório, ou o runner foi
      rodado por cima.
- [ ] O banco restaurado é apagado ao fim (`DROP DATABASE nekolog_restaurado`).

Registre a data do último teste bem-sucedido. Se não houver registro, considere
que não foi testado. **Hoje não há registro de nenhum dos dois**: falta a
variável `BACKUPS_ENABLED`, a máquina, o bucket e o par de chaves do `age`.

## 5. Se não houver backup utilizável

- Organizações e projetos: perda total; é preciso recriar e avisar.
- Keys: só o hash era guardado, então mesmo com backup ninguém recupera a key
  original — todos os clientes precisam gerar novas. Se o
  `.nekolog-seed.json` também se perdeu, **nem o hash sobrou**.
- Logs: o que o ClickHouse perdeu sem backup não volta de lugar nenhum. É o
  dado pelo qual o cliente paga.
- Trate como incidente de segurança e siga
  [incidente §5](incidente.md#5-se-for-incidente-de-segurança): indisponibilidade
  prolongada de dado pessoal também tem implicação sob a LGPD.

## Como o backup do Postgres roda hoje

**Na máquina, não no GitHub.** O container `backup` do `deploy/self-host` roda
`pg_dump | gzip | age | rclone rcat` num cano só: nenhum `.sql` legível existe
em momento algum, nem dentro do container. Ele não guarda estado — pergunta ao
bucket o que já tem do dia — e **não apaga nada num dia em que falhou em
escrever**.

Saiu do Actions por dois motivos. O primeiro é prático: o Postgres da VPS não
publica porta nenhuma, então um runner do GitHub não tem como alcançá-lo sem
expor o banco na internet. O segundo é de custo: o repositório é privado e os
minutos do Actions passaram a ser contados.

### Uma coisa que esteve errada o tempo todo

O workflow mandava a connection string inteira em `PGDATABASE`. A libpq trata
essa variável como **nome de banco**, não como URI, então o `pg_dump` ignorava
host, porta, usuário e senha e tentava o socket local. Ninguém tinha visto
porque o workflow nunca rodou. O `pgEnvFrom` agora quebra a URI nas variáveis
que a libpq realmente lê. Se você tiver um procedimento manual anotado em algum
lugar com `PGDATABASE=postgres://…`, ele não funciona.

## O backup do ClickHouse roda de outro jeito

Não é um cano de comandos num workflow: é a tarefa `clickhouse-backup` no
`apps/jobs`, que acorda de hora em hora e pergunta ao próprio ClickHouse o que
já aconteceu hoje. Se o dia já tem um backup pronto, ou se tem um em andamento,
ela não faz nada. Se tem uma tentativa que falhou, ela **avisa e tenta de
novo**. Se não consegue nem ler o histórico, **avisa e não começa nada** — não
dá para decidir "ninguém fez backup hoje" com base numa medição que falhou.

Três coisas que valem saber:

- **Cada tentativa tem nome próprio**, com o momento dentro. O ClickHouse se
  recusa a escrever por cima de um backup existente, então uma retentativa sobre
  o mesmo nome falharia para sempre.
- **O período é o dia UTC.** O `system.backups` é uma tabela em memória: se o
  ClickHouse reiniciar, a tarefa esquece o que já fez e tira outro backup. Isso
  é de propósito — na dúvida, fazer backup demais.
- **Nada aqui apaga backup velho**, porque o ClickHouse não sabe apagar objeto
  em S3. A retenção é a regra de ciclo de vida do bucket, declarada em
  [`infra/vps`](../../infra/vps). Sem ela, o bucket cresce para sempre.
