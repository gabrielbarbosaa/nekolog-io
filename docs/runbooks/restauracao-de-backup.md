# Runbook — Restauração de backup

> Leia o [aviso sobre o estado dos runbooks](README.md#estado-destes-runbooks).

## O que tem backup e o que não tem

| Dado | Backup | Se perder |
|---|---|---|
| **Postgres** (usuários, orgs, projetos, ambientes, keys, alertas, audit log) | `pg_dump` diário, cifrado com `age`, no R2, retenção de 30 dias | Restaurar. É o único dado insubstituível. |
| **ClickHouse** (logs) | `BACKUP DATABASE` diário para um bucket S3 fora da máquina, se configurado | Restaurar. É o dado pelo qual o cliente paga. |
| **Redis** (códigos, sessões) | **Nenhum**, por decisão | Todo mundo faz login de novo. |
| **R2** (source maps, exportações) | Nenhum | Exportações são regeneráveis; source maps são reenviados no próximo deploy do cliente. |

A linha do ClickHouse dizia "nenhum, por decisão — perda aceita: logs são
descartáveis". Isso valia para um projeto de estudo e **deixou de valer no dia
em que alguém paga para guardar esses logs**. Hoje existe backup; o que não
existe é obrigação de configurá-lo, e um container de jobs sem destino avisa
isso em toda partida.

## 1. Decidir se é para restaurar

Restauração **sobrescreve dados**. Antes de começar:

1. **Qual é o dano exato?** Tabela corrompida, registro apagado por engano,
   banco inteiro perdido? Para um registro só, editar direto costuma ser melhor
   que restaurar tudo.
2. **Quanto se perde?** O backup é diário. Restaurar significa perder tudo
   depois do último dump — contas criadas, keys geradas, regras de alerta.
3. **Branch do Neon em vez de sobrescrever.** O Neon permite criar uma branch do
   banco. **Restaure numa branch nova, confira, e só então aponte a aplicação
   para ela.** Nunca restaure por cima do banco de produção às cegas.

## 2. Restaurar

> Comandos não executados — conferir antes de usar em produção.

1. **Localize o dump** no R2, bucket de backups, pela data desejada.
2. **Decifre com `age`.** A chave privada está **offline, com o autor** — só a
   pública (`BACKUP_AGE_RECIPIENT`) fica no CI, justamente para que o CI
   comprometido não consiga ler backup.
   ```bash
   age --decrypt -i «chave-privada» -o dump.sql backup-«data».sql.age
   ```
3. **Crie uma branch do banco no Neon** a partir do estado atual (preserva o
   que existe hoje, caso a restauração seja a decisão errada).
4. **Restaure na branch:**
   ```bash
   psql "«DATABASE_URL-da-branch»" < dump.sql
   ```
5. **Confira antes de apontar a aplicação.** No mínimo: contagem de `users`,
   `organizations` e `api_keys` bate com o esperado? O audit log tem registro
   até a data do dump?
6. **Aponte a aplicação** para a branch restaurada, atualizando `DATABASE_URL`
   no ambiente correspondente.

## 3. Reconciliar

Restaurar o Postgres deixa o resto do sistema fora de sincronia:

- **KV das keys.** Keys criadas depois do dump sumiram do Postgres mas podem
  continuar no KV (funcionando sem registro), e keys revogadas depois podem ter
  voltado a existir. **Ressincronize o KV a partir do Postgres restaurado.**
- **Sessões no Redis.** Apontam para usuários que podem não existir mais.
  Encerrar todas as sessões é o caminho seguro.
- **Logs no ClickHouse** referenciam `project_id` e `environment_id` que talvez
  não existam mais no Postgres. Isso aparece como log órfão no dashboard.
- **Agendamentos** (exportações, regras de alerta) voltam ao estado do dump:
  regras criadas depois precisam ser recriadas, regras apagadas voltam a
  disparar.

## 3.5. Restaurar o ClickHouse

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
repositório estiverem à frente, rode o runner por cima do banco restaurado antes
de usá-lo.

**Quem pode restaurar não é quem faz o backup.** O `nekolog_backup` só tem
`BACKUP`, `WRITE ON S3` e leitura de `system.backups`: ele escreve a cópia e não
consegue ler uma linha de log nem trazer nada de volta. O `nekolog_migrator` não
tem acesso nenhum a S3. A restauração roda como `default`, com a senha do
`.env`, e isso é de propósito: restaurar é quebra de vidro, e nenhuma credencial
de rotina deveria conseguir fazer.

## 4. Teste de restauração (não espere o incidente)

O plano exige **teste a cada marco** (seção 15.3). Um backup nunca restaurado
não é um backup — é um arquivo.

O teste é o procedimento acima inteiro, numa branch descartável do Neon:

- [ ] O dump do dia existe no R2 e tem tamanho plausível.
- [ ] A chave `age` decifra (**confirma que a chave offline ainda existe e é a
      certa** — esse é o ponto de falha mais provável de todos).
- [ ] O `psql` restaura sem erro.
- [ ] As contagens batem com produção.
- [ ] A branch é apagada ao fim.

Registre a data do último teste bem-sucedido. Se não houver registro, considere
que não foi testado.

## 5. Se não houver backup utilizável

- Usuários e organizações: perda total; é preciso recriar e avisar.
- Keys: só o hash era guardado, então mesmo com backup ninguém recupera a key
  original — todos os clientes precisam gerar novas.
- Trate como incidente de segurança e siga
  [incidente §5](incidente.md#5-se-for-incidente-de-segurança): indisponibilidade
  prolongada de dado pessoal também tem implicação sob a LGPD.

## Como o backup roda hoje

O workflow [`backup.yml`](../../.github/workflows/backup.yml) faz o dump diário às
05:17 UTC: `pg_dump | gzip | age` num cano só, sem arquivo legível no meio, e
confere a assinatura `age-encryption.org` antes de subir para o R2. A limpeza
usa o `internal/backup`, que **recusa** apagar a lista inteira — se tudo parece
vencido, o errado é o relógio.

**O teste de restauração é o mesmo workflow**, disparado à mão com
`restore_test`: ele baixa o backup mais recente, restaura num Postgres
descartável e consulta cada tabela, uma a uma. Backup que ninguém restaurou é
esperança, não backup.

Nada disso roda ainda: falta a variável `BACKUPS_ENABLED`, o banco no Neon, o
bucket no R2 e o par de chaves do `age`.

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
  em S3. A retenção é uma regra de ciclo de vida no bucket. Sem ela, o bucket
  cresce para sempre.
