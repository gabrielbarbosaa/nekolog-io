# Runbook — Rotação de segredos

> Leia o [aviso sobre o estado dos runbooks](README.md#estado-destes-runbooks).

Dois contextos, com regras diferentes:

- **Rotina** (a cada 6 meses, ou quando alguém perde acesso ao ambiente): dá
  para fazer sem derrubar ninguém, aceitando a chave antiga por um período.
- **Comprometimento**: a chave antiga precisa parar de funcionar **agora**,
  mesmo que isso derrube sessões. Veja
  [vazamento de key](vazamento-de-key.md) primeiro.

Onde cada segredo vive está na especificação 2
([ESPECIFICACOES.md](../ESPECIFICACOES.md)). Segredos de aplicação ficam nos
cofres de cada serviço (GitHub Environments, Cloudflare, Vercel), separados por
ambiente.

**Rotacione sempre `dev` → `qa` → `prod`.** Se o procedimento tem um erro, você
descobre em `dev`.

---

## 1. Chave do JWT (`AUTH_JWT_*`)

É a única rotação que foi **desenhada para não derrubar sessão** — o `kid` no
token existe exatamente para isso.

1. Gere um par Ed25519 novo:
   ```bash
   openssl genpkey -algorithm Ed25519 -out jwt-new.pem
   openssl pkey -in jwt-new.pem -pubout -out jwt-new.pub
   ```
2. **Mova a pública atual** para `AUTH_JWT_PREVIOUS_PUBLIC_KEY`.
3. Grave a nova em `AUTH_JWT_PRIVATE_KEY` / `AUTH_JWT_PUBLIC_KEY`, com um
   `AUTH_JWT_KID` **novo**.
4. Deploy. A partir daí tokens novos usam a chave nova; tokens emitidos antes
   continuam válidos porque a pública anterior ainda é aceita.
5. **Espere mais que a validade do access token (10 min).** Na prática, espere
   algumas horas.
6. Remova `AUTH_JWT_PREVIOUS_PUBLIC_KEY`. A chave antiga morre aqui.

> **Se for comprometimento:** pule o passo 2. Não aceitar a chave anterior
> derruba todas as sessões — que é exatamente o que se quer, porque a chave
> vazada forja qualquer sessão.

## 2. Segredo dos códigos de login (`AUTH_OTP_SECRET`)

Os códigos são guardados como HMAC desse segredo, com TTL de 10 minutos.

1. Gere: `openssl rand -base64 32`
2. Substitua e faça deploy.
3. **Códigos em voo param de validar na hora.** Quem estava no meio de um login
   precisa pedir outro código. Com TTL de 10 min, o impacto é pequeno — prefira
   um horário de baixo uso.

Não há mecanismo de duas chaves aqui, e não vale a pena construir um para 10
minutos de impacto.

## 3. Chave de criptografia do banco (`ENCRYPTION_KEY`)

**A mais perigosa**, porque ela decifra dados em repouso: URLs de webhook e
tokens de canal guardados no Postgres.

⚠️ **Trocar a chave sem recriptografar torna esses dados ilegíveis
permanentemente.** Não existe recuperação.

Procedimento (ainda não implementado — precisa de um script dedicado):

1. Faça backup do Postgres **antes** (veja
   [restauração de backup](restauracao-de-backup.md)).
2. Com a chave antiga e a nova disponíveis, rode o script que lê cada valor
   cifrado, decifra com a antiga e regrava com a nova.
3. Só depois remova a chave antiga.

> **Pendência real:** esse script não existe. Precisa ser escrito antes do M5,
> quando canais de alerta passarem a guardar segredo. Rotacionar essa chave
> hoje, sem ele, destrói dados.

## 4. Senhas do ClickHouse

São três usuários com permissões distintas: `INSERT` (ingestão), `SELECT`
(dashboard) e jobs.

1. Crie o usuário novo **antes** de remover o antigo, para não haver janela sem
   acesso:
   ```sql
   -- «conferir sintaxe na versão em uso»
   CREATE USER nekolog_insert_v2 IDENTIFIED BY '«nova-senha»';
   GRANT INSERT ON nekolog_«ambiente».* TO nekolog_insert_v2;
   ```
2. Atualize o secret no cofre do serviço que usa aquele usuário.
3. Deploy.
4. Confirme que o acesso funciona (envie um log de teste; confira o `/health`).
5. **Só então** remova o usuário antigo: `DROP USER nekolog_insert;`

Se fizer na ordem inversa, a ingestão para entre o `DROP` e o deploy.

## 5. Tokens de deploy e de provedor

`CLOUDFLARE_API_TOKEN`, `INFRA_GITHUB_TOKEN`, `VERCEL_API_TOKEN`, `OCI_*`,
`CF_KV_API_TOKEN`, e as credenciais S3 do bucket de estado
(`TOFU_STATE_ACCESS_KEY_ID` e `TOFU_STATE_SECRET_ACCESS_KEY`).

O `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` dos Workers **não** entram
aqui: eles são saída do OpenTofu. Rotacionar é subir o
`client_secret_version` do `cloudflare_zero_trust_access_service_token`, aplicar
e levar a saída nova para os segredos do Worker.

1. Crie o token novo no provedor, **com o menor escopo que funcione** — a
   rotação é uma boa hora para perceber que o token antigo tinha permissão
   demais.
2. Atualize no GitHub Environment correspondente.
3. Rode o workflow que o usa, para confirmar.
4. Revogue o antigo **no provedor**. Remover do GitHub não revoga nada.

## 6. `TF_ENCRYPTION`

Decifra o estado do OpenTofu, que contém o segredo do túnel e o client secret
do service token do Access. Tratar como a chave mestra.

O segredo guarda o HCL inteiro da criptografia, não só a frase — ver
[infra/README.md](../../infra/README.md). Ele nunca aparece no código: as raízes
declaram só `enforced = true`.

**Não troque a frase editando o segredo.** O estado no R2 continua cifrado com a
antiga, e o próximo `init` não consegue abrir. A troca é em dois passos, porque
o estado precisa ser **recriptografado**:

1. Faça backup do estado atual: `wrangler r2 object get` de cada
   `<ambiente>/terraform.tfstate`, guardado fora do GitHub.
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

3. Rode `tofu apply` em **cada** raiz — `envs/dev`, `envs/qa`, `envs/prod` e
   `repo`. É a escrita do estado que o recriptografa; um `plan` não basta.
4. Só então tire o `fallback` e o `key_provider` antigo, e rode de novo para
   confirmar que abre sem ele.
5. Guarde a nova fora do GitHub também. Perdê-la significa perder o controle do
   estado — e, com `enforced = true`, não há estado em claro para recuperar.

## 7. Depois de qualquer rotação

- [ ] A credencial antiga **não funciona mais** (teste, não presuma).
- [ ] Os três ambientes foram rotacionados, ou está registrado por que não.
- [ ] `.env.example` atualizado, se o nome de alguma variável mudou.
- [ ] Registro no `audit_log`.
- [ ] Se foi por comprometimento, o
      [modelo de ameaças](../security/threat-model.md) foi revisado.
