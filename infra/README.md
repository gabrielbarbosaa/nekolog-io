# infra

A infraestrutura como código, em OpenTofu
(ADR [0009](../docs/adr/0009-opentofu-para-infraestrutura.md)).

```
modules/
  workers-kv/    namespace KV com as keys que a ingestão lê
  r2-buckets/    contingência (spool) e source maps
  tunnel/        Cloudflare Tunnel e o CNAME que aponta para ele
  access/        service token dos Workers, políticas e a aplicação Access
  workers-domain/ o hostname que o Worker de ingestão atende
  environment/   junta os cinco; é o que cada ambiente chama
  oracle-vm/     a VM, a rede sem entrada e o cloud-init
  ssh-access/    a aplicação Access na frente do SSH da máquina
envs/{dev,qa,prod}/   uma raiz por ambiente, um estado por ambiente
repo/                 rulesets do GitHub; não é um ambiente, é o repositório
vm/                   a VM; também não é um ambiente — é uma máquina para os três
```

A `vm` lê os três estados de ambiente com `terraform_remote_state`, para montar
o arquivo de credenciais de cada `cloudflared`. Ela aplica depois deles, e só
pela `main`. O que roda dentro da máquina está em
[`deploy/vm/`](../deploy/vm/README.md).

## Nada disso foi aplicado ainda

Esta etapa entrega o **código e o pipeline**, não a infraestrutura. O `apply` só
roda quando a variável de repositório `INFRA_ENABLED` for `true`, e ela não
existe. Sem ela o workflow faz só `fmt` e `validate`, que não precisam de
credencial nenhuma.

Isso é de propósito: não há conta Cloudflare configurada, nem bucket de estado,
e o `apply` do `infra/repo` mexeria nas proteções de branch deste repositório.
Ligar isso é uma decisão sua, não um efeito colateral de mergear um PR.

## Antes de ligar

### 1. O bucket do estado existe antes do OpenTofu

Problema do ovo e da galinha: o estado mora no R2, e o R2 é gerenciado pelo
OpenTofu. O bucket do estado **não** é gerenciado por ele — crie à mão, uma vez:

```bash
wrangler r2 bucket create nekolog-tfstate
```

Gere um token de API do R2 (S3) com leitura e escrita nesse bucket. Ele vira
`TOFU_STATE_ACCESS_KEY_ID` e `TOFU_STATE_SECRET_ACCESS_KEY`.

### 2. A frase secreta do estado

O estado guarda o segredo do túnel e o client secret do service token em claro.
Por isso a criptografia nativa do OpenTofu é **obrigatória**: cada raiz declara
`enforced = true` para estado e plano.

A chave em si vem da variável de ambiente `TF_ENCRYPTION`, nunca do código:

```hcl
key_provider "pbkdf2" "state" {
  passphrase = "…"
}

method "aes_gcm" "state" {
  keys = key_provider.pbkdf2.state
}

state {
  method = method.aes_gcm.state
}

plan {
  method = method.aes_gcm.state
}
```

Guarde esse HCL inteiro no segredo `TF_ENCRYPTION`. **Perder a frase secreta é
perder o controle do estado** — está no runbook de rotação de segredos.

Os jobs de `plan` e `apply` falham de cara se `TF_ENCRYPTION` estiver vazio.

### 3. O token da Cloudflare

Um token de conta com, no mínimo:

| Permissão | Para quê |
|---|---|
| `Workers KV Storage` — edição | o namespace das keys |
| `Workers R2 Storage` — edição | os buckets |
| `Cloudflare Tunnel` — edição | o túnel |
| `Access: Apps and Policies` — edição | a aplicação e as políticas |
| `Access: Service Tokens` — edição | o token que os Workers usam |
| `Zone` → `DNS` — edição, na zona `nekolog.io` | o CNAME do túnel |
| `Workers Scripts` — edição | o `wrangler deploy` e o domínio do Worker |

O mesmo token serve para o workflow `Workers`. Se preferir separar, o do deploy
precisa só de `Workers Scripts` — edição.

### 4. O token do GitHub

Só para `infra/repo`: um token com `administration:write` no repositório. O
`GITHUB_TOKEN` do Actions **não serve** — ele não administra rulesets.

### 5. Variáveis e segredos

Variáveis de repositório: `INFRA_ENABLED`, `TOFU_STATE_BUCKET`,
`TOFU_STATE_ENDPOINT` (`https://<account>.r2.cloudflarestorage.com`),
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID` e `OPERATOR_EMAILS` (um JSON de
lista, porque o tipo da variável é `list(string)`: `["voce@exemplo.com"]`).

Segredos: `TF_ENCRYPTION`, `TOFU_STATE_ACCESS_KEY_ID`,
`TOFU_STATE_SECRET_ACCESS_KEY`, `CLOUDFLARE_API_TOKEN` e `INFRA_GITHUB_TOKEN`.

Crie os *environments* `dev`, `qa` e `prod` no GitHub, com aprovação manual no
`prod`. O `apply` usa o environment da branch; é o que dá o passo manual que o
plano pede para produção.

## O que o `validate` pega, e o que não

Sem conta nenhuma configurada, o CI consegue rodar `fmt -check` e `validate`.
Isso é mais do que parece: o `validate` confere o HCL contra o **schema real do
provider**, então nome de recurso, nome de atributo e tipo errados falham ali.

Mas tem um limite, e ele foi medido quebrando o código de propósito:

| O que quebrei | O `validate` pegou? |
|---|---|
| atributo que não existe no recurso | sim |
| argumento obrigatório faltando | sim |
| tipo errado num atributo aninhado | sim |
| versão de provider que o lock não satisfaz | sim |
| `enforced = true` removido | sim, pela guarda do workflow |
| **atributo opcional escrito errado dentro de objeto aninhado** | **não** |

O último é o que importa saber. Escrever `serivce_token` em vez de
`service_token` dentro de um `include` passa batido: a conversão de objeto do
HCL **descarta** atributo que o tipo de destino não tem, e como todos ali são
opcionais, sobra uma regra vazia. O resultado seria uma política que não deixa
ninguém entrar — não é um buraco de segurança, mas é um apply quebrado que o CI
não anuncia.

Por isso as duas políticas do módulo `access` têm `postcondition`: elas afirmam
que o `include` resultante é exatamente o service token, e exatamente os
e-mails de operador. **Essas verificações só rodam no `plan`**, que depende da
conta existir. O `validate` não as executa.

## O fluxo

| Quando | O que roda |
|---|---|
| PR que toca `infra/` | `fmt -check` e `validate` nas cinco raízes |
| mesmo PR, com `INFRA_ENABLED` | `plan` nas cinco raízes |
| merge na `dev` | `apply` em `envs/dev` |
| merge na `qa` | `apply` em `envs/qa` |
| merge na `main` | `apply` em `envs/prod`, em `repo` e na `vm` |

Os rulesets do repositório só mudam pela `main`, de propósito: são a proteção
que impede qualquer uma das outras branches de fazer o que quiser.

## Os rulesets já existem

Eles foram criados à mão no M0. O `infra/repo` **adota** os três por bloco
`import`, com os ids em `adopt_ruleset_ids`, em vez de criar. Criar daria
"name already in use", e apagar e recriar abriria uma janela sem proteção
nenhuma.

Antes do primeiro `apply` aqui, **leia o plano com atenção**. Se o provider não
souber reproduzir algum campo que a interface do GitHub escreveu, o plano vai
propor removê-lo — e aí o `apply` enfraqueceria a proteção em vez de registrá-la.
O campo `require_extra_approval_for_unattributed_changes`, que hoje está ligado
nos três, é o candidato mais provável. O `plan` existe exatamente para essa
conferência.

## Rodando na mão

```bash
export TF_ENCRYPTION='key_provider "pbkdf2" "state" { … }'
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…
export TF_VAR_cloudflare_api_token=… TF_VAR_cloudflare_account_id=…
export TF_VAR_cloudflare_zone_id=… TF_VAR_operator_emails='["voce@exemplo.com"]'

cat > backend.hcl <<'EOF'
bucket    = "nekolog-tfstate"
endpoints = { s3 = "https://<account>.r2.cloudflarestorage.com" }
EOF

tofu -chdir=infra/envs/dev init -backend-config=../../../backend.hcl
tofu -chdir=infra/envs/dev plan
```

`backend.hcl` e qualquer `*.tfvars` estão no `.gitignore`. Os
`.terraform.lock.hcl` **não** estão: eles fixam o hash de cada provider, e o CI
falha se um deles mudar sozinho.

### 6. A Oracle, para a `vm`

Uma chave de API do OCI, com o par OCID da tenancy, OCID do usuário,
*fingerprint* e a chave privada. Variáveis: `OCI_TENANCY_OCID`, `OCI_USER_OCID`,
`OCI_FINGERPRINT`, `OCI_REGION`, `OCI_COMPARTMENT_OCID` e `VM_SSH_PUBLIC_KEY`;
segredo: `OCI_PRIVATE_KEY`.

A `vm` também precisa de `TOFU_STATE_BUCKET` e `TOFU_STATE_ENDPOINT` como
variáveis **de entrada** (`TF_VAR_state_bucket` e `TF_VAR_state_endpoint`), além
de backend: ela lê os três estados de ambiente para montar as credenciais do
`cloudflared`. Desde a 1.18 ela também fala com a Cloudflare, para o quarto
túnel e a aplicação Access do SSH: precisa de `TF_VAR_cloudflare_api_token`,
`TF_VAR_cloudflare_account_id`, `TF_VAR_cloudflare_zone_id` e
`TF_VAR_operator_emails`.

## A ordem no primeiro apply

O domínio do Worker aponta para um Worker **pelo nome**, e a Cloudflare recusa
apontar para um que não existe. Então, da primeira vez, a ordem é:

1. `WORKERS_DEPLOY_ENABLED=true` e um merge: o `wrangler deploy` cria
   `nekolog-ingest-<ambiente>`. A verificação de `/health` no fim vai falhar,
   porque ainda não existe hostname — é esperado.
2. `INFRA_ENABLED=true` e o `apply` do ambiente: aí nasce
   `ingest-<ambiente>.nekolog.io`.
3. O próximo deploy passa inteiro, `/health` incluído.

Depois disso a ordem não importa mais. Deixar o `wrangler` criar o domínio
sozinho evitaria esse passo, mas colocaria duas ferramentas escrevendo na mesma
zona; a seção 18 do plano diz que as rotas ficam aqui.

## SSH, que não tem porta aberta

A lista de segurança da OCI continua **só com saída**. O caminho até o `sshd` é
um quarto túnel (`ssh.nekolog.io`), e na frente dele uma aplicação Access cuja
política só aceita os e-mails de operador:

```bash
cloudflared access ssh --hostname ssh.nekolog.io
```

O service token dos Workers **não** alcança essa aplicação: ela é outra, com
outra política, e uma `postcondition` afirma que ela tem exatamente uma política
— a dos operadores. Um token de serviço entrar ali seria um robô com shell.

## O que ainda não está aqui

- **Vercel, Turnstile, Email Routing, Neon e Upstash** — o plano os prevê
  (seção 15.5); entram quando houver o que configurar.

## Saídas

Cada ambiente devolve o que os Workers e a VM precisam: `kv_namespace_id`,
`spool_bucket`, `sourcemaps_bucket`, `ingest_hostname`, `clickhouse_url`,
`tunnel_id`, `tunnel_account_tag`, `tunnel_secret`, `access_client_id` e
`access_client_secret`. As três últimas são `sensitive` — saem com `tofu output
-raw`, e vão para os segredos do Worker, nunca para um arquivo.

A `vm` devolve `instance_id`, `public_ip`, `ssh_hostname` e
`clickhouse_passwords` (sensível).
