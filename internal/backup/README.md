# @internal/backup

O backup do Postgres: como o objeto se chama, o que já venceu, qual é a sequência
de comandos e como ela é executada. Quem roda isso é o container `backup` do
`deploy/self-host`, uma vez por dia; o `apps/jobs/src/backup.ts` é só a fiação.

```bash
node internal/backup/src/cli.ts key --environment prod
node internal/backup/src/cli.ts expired --keys-file stored.txt --keep-days 30
```

## O dump nunca toca o disco em claro

`pg_dump | gzip | age | rclone rcat` é um cano só, do banco até o bucket. Não
existe passo intermediário gravando um `.sql` legível que alguém esquece de
apagar, e não existe arquivo temporário nem no container.

A chave do `age` é um par: **só a metade pública fica na máquina**
(`BACKUP_AGE_RECIPIENT`). A privada fica offline, com você. Isso é o que faz
diferença no dia em que alguém entra na máquina: ele alcança o bucket e os
backups continuam ilegíveis.

## `PGDATABASE` não aceita uma URI, e isso custou um dump

O workflow original passava a connection string inteira em `PGDATABASE`. A
libpq trata essa variável como **nome de banco**, não como URI — então o
`pg_dump` ignorava host, porta, usuário e senha e tentava o socket local:

```
pg_dump: error: connection to server on socket "/run/postgresql/.s.PGSQL.5432"
failed: No such file or directory
```

Nunca ninguém tinha visto porque o workflow nunca rodou (`BACKUPS_ENABLED` não
existe). `pgEnvFrom` agora quebra a URI em `PGHOST`, `PGPORT`, `PGUSER`,
`PGPASSWORD`, `PGDATABASE` e `PGSSLMODE`, decodificando o que a URL teve que
escapar — uma senha com `@` ou `/` chega inteira.

## A senha não vai em argumento

Nenhuma credencial entra na linha de comando: argumento de processo é legível
por qualquer outro processo da máquina. O Postgres vai pelas variáveis da libpq
e o bucket vai pelas `RCLONE_CONFIG_BACKUP_*`. `assertNoSecretInArgs` recusa
qualquer argumento que pareça uma connection string com senha, e há teste para
cada metade.

## Apagar tudo não é uma retenção

`expired` devolve o que passou dos 30 dias e **recusa** devolver a lista
inteira: se todos os backups parecem vencidos, o que está errado é o relógio.
Objeto que não é um backup nosso (prefixo, sufixo e carimbo conferidos) nunca
entra na lista.

E a ordem importa: **nada é apagado num dia em que o backup falhou.** A poda só
roda depois que o novo objeto subiu, com ele já na lista — então sempre existe
pelo menos um sobrevivente.

## O cano é executado por processos de verdade, e testado assim

`runPipeline` liga o stdout de cada etapa no stdin da próxima, junta o stderr de
cada uma e **relata todas as que falharam**, não só a primeira: quando o
`rclone` morre, o `pg_dump` morre junto com EPIPE, e dizer só "pg_dump falhou"
mandaria você olhar o lugar errado. Os testes montam canos com o próprio Node,
inclusive um de 4 MB para provar que não trava em backpressure e um `abort` que
mata a cadeia.

## O que não está aqui

O backup do **ClickHouse** é outro mecanismo: o próprio servidor escreve
(`BACKUP DATABASE … TO S3`), sem passar por este processo. Ele vai para o mesmo
bucket e **não é cifrado com `age`** — a confidencialidade dele depende do
controle de acesso do bucket. Está registrado assim no modelo de ameaças
(**I15**), não é esquecimento.

O runbook de restauração está em
[`docs/runbooks/restauracao-de-backup.md`](../../docs/runbooks/restauracao-de-backup.md).
