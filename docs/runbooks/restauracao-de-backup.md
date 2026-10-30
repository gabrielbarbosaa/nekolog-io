# Runbook — Restauração de backup

> Leia o [aviso sobre o estado dos runbooks](README.md#estado-destes-runbooks).

## O que tem backup e o que não tem

| Dado | Backup | Se perder |
|---|---|---|
| **Postgres** (usuários, orgs, projetos, ambientes, keys, alertas, audit log) | `pg_dump` diário, cifrado com `age`, no R2, retenção de 30 dias | Restaurar. É o único dado insubstituível. |
| **ClickHouse** (logs) | **Nenhum**, por decisão | Perda aceita: logs são descartáveis e têm TTL curto de qualquer forma. |
| **Redis** (códigos, sessões) | **Nenhum**, por decisão | Todo mundo faz login de novo. |
| **R2** (source maps, exportações) | Nenhum | Exportações são regeneráveis; source maps são reenviados no próximo deploy do cliente. |

Ou seja: **restauração aqui significa Postgres.** Se o problema for ClickHouse,
não há o que restaurar — veja [incidente §3.3](incidente.md#33-logs-não-aparecem).

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
