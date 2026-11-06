# Runbook — Rotação de segredos

> Leia o [aviso sobre o estado dos runbooks](README.md#estado-destes-runbooks).

Dois contextos, com regras diferentes:

- **Rotina** (a cada 6 meses, ou quando alguém perde acesso ao ambiente): dá
  para fazer sem derrubar ninguém, aceitando a chave antiga por um período.
- **Comprometimento**: a chave antiga precisa parar de funcionar **agora**,
  mesmo que isso derrube alguma coisa. Veja
  [vazamento de key](vazamento-de-key.md) primeiro.

## Onde cada segredo mora

Não há mais ambientes separados nem cofre por provedor. São dois lugares:

| Lugar | Quais | Como se troca |
|---|---|---|
| `deploy/self-host/.env`, na máquina, `0600` | senhas do ClickHouse e do Postgres, `ENCRYPTION_KEY`, credenciais do bucket de backup, `OPS_DISCORD_WEBHOOK_URL`, `HEARTBEAT_URL` | editar o arquivo e `docker compose up -d` |
| GitHub (segredos e variáveis do repositório) | `TF_ENCRYPTION`, `TOFU_STATE_*`, `CLOUDFLARE_API_TOKEN`, `INFRA_GITHUB_TOKEN` | pela interface do GitHub, e rodar o workflow que usa |

**Não existe `dev` → `qa` → `prod`.** O ambiente `qa` deixou de existir junto com
a plataforma anterior; `SEED_ENVIRONMENTS` nomeia os ambientes **do cliente**
dentro de um projeto, que é outra coisa. Então não há onde ensaiar: leia o
procedimento inteiro antes de começar, e faça o backup que o passo 1 pedir.

O que diz respeito a login — `AUTH_JWT_*`, `AUTH_OTP_SECRET` — **não está aqui**.
O dashboard é fechado e mora em outro repositório; nenhuma dessas variáveis
existe nesta máquina, e a rotação delas é de lá.

---

## 1. Senhas do ClickHouse

São cinco usuários com permissões distintas, declarados em
[`clickhouse-users.xml`](../../deploy/self-host/clickhouse-users.xml), cada um
lendo a senha do ambiente (`from_env`) e nunca do arquivo:

| Usuário | Para quê |
|---|---|
| `nekolog_ingest` | grava log |
| `nekolog_reader` | lê log (a API pública) |
| `nekolog_jobs` | alertas, issues, cota, exportação |
| `nekolog_backup` | só `BACKUP` e `WRITE ON S3`; não lê uma linha |
| `nekolog_migrator` | o único com DDL |

Trocar uma senha é trocar a variável e reiniciar quem a usa. O arquivo está
montado em `users.d/`, então o ClickHouse recarrega sem perder o volume.

1. Gere a senha: `openssl rand -hex 24` (ou `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`).
2. Troque a linha no `.env`.
3. `docker compose up -d` — o Compose recria só os containers cujo ambiente
   mudou. Reiniciar o `clickhouse` é o que aplica a senha nova.
4. **Confirme antes de considerar feito**: `curl localhost:8787/health` para a
   ingestão, `localhost:8789/health` para a API, e mande um log de teste.

> **Rotacione uma por vez.** Com as cinco juntas, um erro de digitação derruba
> tudo ao mesmo tempo e você não sabe qual foi.

## 2. Senha do Postgres (`POSTGRES_PASSWORD`)

O Postgres guarda a senha no volume no primeiro start — mudar a variável
**não** muda a senha do banco que já existe. A ordem é inversa à do ClickHouse:

1. Troque no banco primeiro:
   ```bash
   docker compose exec postgres psql -U nekolog -c "ALTER USER nekolog PASSWORD '«nova»'"
   ```
2. Só então troque no `.env` e rode `docker compose up -d`.

Entre os dois passos a `api`, os `jobs` e o `backup` ficam sem alcançar o banco.
Faça em horário de baixo uso: a ingestão não depende do Postgres, então os logs
continuam entrando.

## 3. Chave de criptografia do banco (`ENCRYPTION_KEY`)

**A mais perigosa**, porque ela decifra dados em repouso: URLs de webhook e
tokens de canal guardados no Postgres.

⚠️ **Trocar a chave sem recriptografar torna esses dados ilegíveis
permanentemente.** Não existe recuperação, e nem o backup ajuda — o backup
guarda o texto cifrado, não a chave.

Procedimento:

1. Faça backup do Postgres **antes** (veja
   [restauração de backup](restauracao-de-backup.md)).
2. Com as duas chaves em mãos, rode `resealChannelSecrets(run, antiga, nova)`
   **primeiro com `dryRun: true`**. Ele abre cada segredo com a chave antiga e
   não grava nada: se o relatório vier com `failed` vazio, a chave antiga
   realmente abre tudo. Se vier com algo em `failed`, **pare** — ainda há um
   segredo que a chave antiga não abre, e trocar agora o perde.
3. Rode de novo sem o `dryRun`. Cada linha é regravada com a chave nova, e a
   escrita só vale se a linha ainda estiver como foi lida — duas execuções ao
   mesmo tempo não se atropelam.
4. **Rodar duas vezes não faz mal.** Um segredo já na chave nova é reconhecido
   e deixado quieto, contado em `alreadyNew`. Isso é o que permite retomar uma
   execução interrompida no meio.
5. Só depois troque a `ENCRYPTION_KEY` no `.env` e rode `docker compose up -d`.

O segredo em rotação (`previous_sealed_secret`) é movido junto, então uma
rotação de chave do banco no meio de uma rotação de segredo de webhook não
quebra nenhuma das duas.

> **Resolvido na etapa 5.10.** Até então este procedimento não existia, e
> trocar a `ENCRYPTION_KEY` destruía os dados cifrados.

## 3b. Segredo que assina um webhook de alerta

Cada canal de webhook tem o seu, de 32 bytes, gerado pelo servidor. Trocar um
sem avisar quem recebe quebra a verificação do outro lado, então a troca tem
uma janela:

1. Gere um segredo novo e guarde o atual em `previous_sealed_secret`, com
   `secret_rotated_at` marcado. O banco recusa um `previous` sem esse momento,
   e recusa um `previous` igual ao atual.
2. A partir daí o `X-NekoLog-Signature` sai com **as duas** assinaturas,
   separadas por vírgula, a nova primeiro. Quem recebe continua funcionando com
   qualquer uma das duas — é o mesmo desenho que o Stripe e o GitHub usam.
3. Avise quem recebe para passar a conferir a nova.
4. Limpe o `previous_sealed_secret`. A assinatura volta a ser uma só.

Nunca há três: o código recusa mandar mais de duas assinaturas, porque uma
janela que acumula é uma janela que ninguém fecha.

## 4. Credenciais do bucket de backup

`BACKUP_S3_ACCESS_KEY_ID` e `BACKUP_S3_SECRET_ACCESS_KEY` alcançam **todos os
backups do ClickHouse** — leitura e remoção. Rotacionar é no painel do
Cloudflare, e a ordem importa pouco porque o backup roda de hora em hora:

1. Crie o token novo no R2, com acesso só àquele bucket.
2. Troque as duas variáveis no `.env` e rode `docker compose up -d`.
3. **Confirme na próxima hora** que um backup novo apareceu no bucket. Um
   backup que parou de acontecer não avisa sozinho a não ser pelo
   `OPS_DISCORD_WEBHOOK_URL`.
4. Revogue o token antigo **no Cloudflare**. Tirar do `.env` não revoga nada.

A `BACKUP_AGE_RECIPIENT` é a metade **pública** de um par `age` — ela não é
segredo e não se rotaciona por comprometimento. Trocar o par significa que os
dumps antigos só abrem com a chave privada antiga: **guarde as duas** enquanto
houver backup antigo dentro da retenção.

## 5. Tokens de provedor

`CLOUDFLARE_API_TOKEN`, `INFRA_GITHUB_TOKEN` e as credenciais S3 do bucket de
estado (`TOFU_STATE_ACCESS_KEY_ID` e `TOFU_STATE_SECRET_ACCESS_KEY`). Todos são
segredos do repositório no GitHub, usados só pelo workflow
[`infra.yml`](../../.github/workflows/infra.yml).

1. Crie o token novo no provedor, **com o menor escopo que funcione** — a
   rotação é uma boa hora para perceber que o token antigo tinha permissão
   demais.
2. Atualize o segredo no GitHub.
3. Rode o workflow que o usa, para confirmar. Um `plan` basta: ele lê o estado
   e fala com o provedor sem mudar nada.
4. Revogue o antigo **no provedor**. Remover do GitHub não revoga nada.

## 6. `TF_ENCRYPTION`

Decifra o estado do OpenTofu. Tratar como a chave mestra.

O segredo guarda o HCL inteiro da criptografia, não só a frase — ver
[infra/README.md](../../infra/README.md). Ele nunca aparece no código: as raízes
declaram só `enforced = true`.

**Não troque a frase editando o segredo.** O estado no bucket continua cifrado
com a antiga, e o próximo `init` não consegue abrir. A troca é em dois passos,
porque o estado precisa ser **recriptografado**:

1. Faça backup do estado atual: baixe `repo/terraform.tfstate`,
   `email/terraform.tfstate` e `vps/terraform.tfstate` do bucket (qualquer
   cliente S3 serve) e guarde fora do GitHub.
2. Monte um `TF_ENCRYPTION` com os **dois** provedores de chave, o novo como
   método principal e o antigo como `fallback`:

   ```hcl
   key_provider "pbkdf2" "new" { passphrase = "«nova»" }
   key_provider "pbkdf2" "old" { passphrase = "«antiga»" }

   method "aes_gcm" "new" { keys = key_provider.pbkdf2.new }
   method "aes_gcm" "old" { keys = key_provider.pbkdf2.old }

   state {
     method = method.aes_gcm.new
     fallback { method = method.aes_gcm.old }
   }

   plan {
     method = method.aes_gcm.new
     fallback { method = method.aes_gcm.old }
   }
   ```

3. Rode `tofu apply` em **cada** raiz — `repo`, `email` e `vps`. É a escrita do
   estado que o recriptografa; um `plan` não basta. O workflow aplica as três,
   e há um teste que falha se uma raiz nova ficar de fora.
4. Só então tire o `fallback` e o `key_provider` antigo, e rode de novo para
   confirmar que abre sem ele.
5. Guarde a nova fora do GitHub também. Perdê-la significa perder o controle do
   estado — e, com `enforced = true`, não há estado em claro para recuperar.

## 7. Depois de qualquer rotação

- [ ] A credencial antiga **não funciona mais** (teste, não presuma).
- [ ] A máquina voltou inteira: `docker compose ps` sem nada reiniciando, e
      `/health` respondendo nas três portas.
- [ ] O `.env` continua `0600` e tem cópia fora da máquina. A `ENCRYPTION_KEY`
      não é recuperável do banco.
- [ ] `.env.example` atualizado, se o nome de alguma variável mudou.
- [ ] Registro no `audit_log`.
- [ ] Se foi por comprometimento, o
      [modelo de ameaças](../security/threat-model.md) foi revisado.
