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

`CLOUDFLARE_API_TOKEN`, `VERCEL_API_TOKEN`, `GITHUB_ADMIN_TOKEN`, `OCI_*`,
`CF_KV_API_TOKEN`, credenciais do R2.

1. Crie o token novo no provedor, **com o menor escopo que funcione** — a
   rotação é uma boa hora para perceber que o token antigo tinha permissão
   demais.
2. Atualize no GitHub Environment correspondente.
3. Rode o workflow que o usa, para confirmar.
4. Revogue o antigo **no provedor**. Remover do GitHub não revoga nada.

## 6. `TOFU_STATE_PASSPHRASE`

Decifra o estado do OpenTofu, que contém os outros segredos de infraestrutura.
Tratar como a chave mestra.

1. Backup do estado atual antes de qualquer coisa.
2. Siga o procedimento de troca de chave de criptografia de estado do OpenTofu
   («conferir na documentação da versão em uso» — o estado precisa ser
   recriptografado, não só reconfigurado).
3. Guarde a nova fora do GitHub também. Perdê-la significa perder o controle do
   estado.

## 7. Depois de qualquer rotação

- [ ] A credencial antiga **não funciona mais** (teste, não presuma).
- [ ] Os três ambientes foram rotacionados, ou está registrado por que não.
- [ ] `.env.example` atualizado, se o nome de alguma variável mudou.
- [ ] Registro no `audit_log`.
- [ ] Se foi por comprometimento, o
      [modelo de ameaças](../security/threat-model.md) foi revisado.
