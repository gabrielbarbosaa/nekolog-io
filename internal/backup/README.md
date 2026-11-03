# @internal/backup

A parte do backup do Postgres que dá para errar em silêncio: como o objeto se
chama, o que já venceu e qual é a sequência de comandos. O trabalho pesado é do
`pg_dump`, do `age` e do `aws s3`, no workflow
[`backup.yml`](../../.github/workflows/backup.yml); aqui fica o que tem teste.

```bash
node internal/backup/src/cli.ts key --environment prod
node internal/backup/src/cli.ts expired --keys-file stored.txt --keep-days 30
```

## O dump nunca toca o disco em claro

`pg_dump | gzip | age` é um cano só. Não existe passo intermediário gravando um
`.sql` legível que alguém esquece de apagar — e o workflow ainda confere a
assinatura `age-encryption.org` no começo do arquivo **antes** de subir, porque
um `age` que falhasse em silêncio produziria um arquivo que parece backup e é
texto puro.

## A senha não vai em argumento

`PGDATABASE` vai no ambiente, nunca na linha de comando: argumento de processo é
legível por qualquer outro processo da máquina. `dumpCommand` recusa qualquer
argumento que pareça uma connection string com senha, e há teste para isso.

## Apagar tudo não é uma retenção

`expired` devolve o que passou dos 30 dias — e **recusa** devolver a lista
inteira. Se todos os backups parecem vencidos, o que está errado é o relógio, e
o custo de agir assim mesmo é não ter mais backup nenhum. Objeto que não é um
backup nosso (prefixo, sufixo e carimbo de tempo conferidos) nunca entra na
lista, então um arquivo solto no bucket não é apagado por engano.

## Restauração conferida, não assumida

O workflow tem um `workflow_dispatch` que baixa o backup mais recente, restaura
num Postgres descartável e **consulta cada tabela**. Backup que ninguém
restaurou é esperança, não backup; é por isso que a verificação lista as tabelas
uma a uma em vez de confiar no código de saída do `psql`.

## Nada disso roda ainda

O workflow está atrás de `BACKUPS_ENABLED`, que não existe, e precisa do banco
Neon, do bucket R2 e do par de chaves do `age` — nenhum deles existe hoje. O
runbook de restauração está em
[`docs/runbooks/restauracao-de-backup.md`](../../docs/runbooks/restauracao-de-backup.md).
