# infra

A infraestrutura como código, em OpenTofu
(ADR [0009](../docs/adr/0009-opentofu-para-infraestrutura.md)).

```
modules/
  email-dns/       SPF, DKIM, DMARC e o encaminhamento do domínio
  vps-dns/         os registros A que apontam cada nome para a máquina
  backup-bucket/   o bucket fora da máquina, e a regra que expira o backup
repo/              rulesets do GitHub; não é um ambiente, é o repositório
email/             SPF, DKIM, DMARC e o encaminhamento; o domínio é um só
vps/               os nomes da máquina e o bucket de backup
```

## O que saiu, e por quê

Até 05/11/2026 havia mais oito módulos e cinco raízes: `envs/{dev,qa,prod}`
descrevia o namespace KV, os buckets R2, o túnel, o Access e o domínio do
Worker de cada ambiente; `vm` descrevia uma instância ARM da Oracle com uma
rede sem entrada; `vercel` descrevia três projetos.

Nada disso é o desenho de hoje. **Tudo roda numa VPS**: a ingestão, a API, os
jobs, o site e a documentação são containers atrás de um Caddy, o spool e os
source maps são arquivos em volumes, e a borda é o Cloudflare Free
([`docs/COMERCIAL.md`](../docs/COMERCIAL.md), tabelas B e D). As três raízes
foram removidas junto com os Workers que as consumiam — e **nenhuma delas
chegou a ser aplicada uma única vez**, então não há estado órfão em lugar
nenhum. O que elas diziam continua no histórico do git.

## E-mail: o domínio é um só, então a raiz é uma só

`infra/email` publica o subdomínio de envio (`mail.nekolog.io`), o SPF e o DKIM
que o provedor exige, o DMARC do apex e o Email Routing que encaminha
`security@`, `dmarc@` e `contato@`.

O DMARC começa em `p=none` por variável, não por acidente — subir direto para
`reject` sem ler relatório nenhum derruba e-mail legítimo que você ainda nem sabe
que existe. `adkim=s` e `aspf=s` ficam estritos desde o começo, porque o envio é
de um subdomínio nosso, não de um provedor compartilhado.

As chaves DKIM só existem depois que o domínio é adicionado no provedor, então
elas entram por variável (`TF_VAR_dkim_records`) e não têm default. **O endereço
para onde o Email Routing encaminha é secret separado**, porque é uma caixa
pessoal e apareceria no plano.

## A máquina: o nome é declarado, o endereço é comprado

`infra/vps` faz duas coisas.

**Os registros A.** Um por nome que o Caddy da máquina atende, todos
*proxied* — é isso que o item B5 chama de "Cloudflare Free na frente". O
endereço entra por `TF_VAR_vps_ipv4`, porque a VPS é comprada à mão no hPanel
e não existe provider para ela que valha a pena.

A lista de nomes tem default (`@`, `ingest`, `api`) e é guardada por teste:
`internal/infra/src/vps.test.ts` falha se o Caddyfile do self-host passar a
atender um nome que não tem registro, ou se existir um registro que o Caddy não
atende. Um nome sem bloco no Caddy não é inofensivo — é um certificado que o
Let's Encrypt nunca consegue emitir.

**O bucket de backup.** O item B8 entregou o backup do ClickHouse e deixou três
coisas para o operador; esta raiz fecha duas: o bucket existe, e ele tem regra
de ciclo de vida. A terceira — restaurar de verdade, da máquina — continua
sendo trabalho de quem tem a máquina.

A regra expira **só o prefixo `clickhouse/`**, e isso não é descuido. O backup
do Postgres apaga os próprios arquivos antigos (`BACKUP_KEEP_DAYS`, em
`internal/backup`); uma regra no bucket inteiro seria uma segunda retenção
sobre os mesmos objetos, com outro número, e ninguém saberia qual venceu. O
teste compara o prefixo da regra com o `BACKUP_KEY_PREFIX` do
`@nekolog-io/clickhouse/backup` e falha se os dois se separarem.

O bucket tem `prevent_destroy`. Um `tofu destroy` distraído não leva os backups
junto.

## Nada disso foi aplicado ainda

Esta parte do repositório entrega o **código e o pipeline**, não a
infraestrutura. O `apply` só roda quando a variável de repositório
`INFRA_ENABLED` for `true`, e ela não existe. Sem ela o workflow faz só `fmt` e
`validate`, que não precisam de credencial nenhuma.

Isso é de propósito: não há conta Cloudflare configurada, nem bucket de estado,
e o `apply` do `infra/repo` mexeria nas proteções de branch deste repositório.
Ligar isso é uma decisão sua, não um efeito colateral de mergear um PR.

## Antes de ligar

### 1. O bucket do estado existe antes do OpenTofu

Problema do ovo e da galinha: o estado mora no R2, e o R2 é gerenciado pelo
OpenTofu. O bucket do estado **não** é gerenciado por ele — crie à mão, uma vez,
pelo painel da Cloudflare ou por API.

Gere um token de API do R2 (S3) com leitura e escrita nesse bucket. Ele vira
`TOFU_STATE_ACCESS_KEY_ID` e `TOFU_STATE_SECRET_ACCESS_KEY`.

### 2. A frase secreta do estado

O estado guarda valores sensíveis em claro. Por isso a criptografia nativa do
OpenTofu é **obrigatória**: cada raiz declara `enforced = true` para estado e
plano.

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
| `Zone` → `DNS` — edição, na zona `nekolog.io` | os registros da máquina e os do e-mail |
| `Email Routing` — edição | o encaminhamento de `security@`, `dmarc@` e `contato@` |
| `Workers R2 Storage` — edição | o bucket de backup |

### 4. O token do GitHub

Só para `infra/repo`: um token com `administration:write` no repositório. O
`GITHUB_TOKEN` do Actions **não serve** — ele não administra rulesets.

### 5. Variáveis e segredos

Variáveis de repositório: `INFRA_ENABLED`, `TOFU_STATE_BUCKET`,
`TOFU_STATE_ENDPOINT` (`https://<account>.r2.cloudflarestorage.com`),
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `VPS_IPV4`, `MAIL_FROM_HOST` e
`MAIL_DMARC_POLICY`.

Segredos: `TF_ENCRYPTION`, `TOFU_STATE_ACCESS_KEY_ID`,
`TOFU_STATE_SECRET_ACCESS_KEY`, `CLOUDFLARE_API_TOKEN`, `INFRA_GITHUB_TOKEN`,
`MAIL_DKIM_RECORDS` e `MAIL_FORWARD_TO`.

Crie o *environment* `prod` no GitHub, com aprovação manual. O `apply` o usa; é
o que dá o passo manual que o plano pede para produção.

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

O último é o que importa saber: a conversão de objeto do HCL **descarta**
atributo que o tipo de destino não tem, e quando todos são opcionais sobra um
bloco vazio que o `validate` aceita. É por isso que o que dá para afirmar em
`validation` e `precondition` está afirmado ali — mas **`precondition` só roda
no `plan`**, que depende da conta existir.

## O fluxo

| Quando | O que roda |
|---|---|
| PR que toca `infra/` | `fmt -check` e `validate` nas três raízes |
| mesmo PR, com `INFRA_ENABLED` | `plan` nas três raízes |
| merge na `main` | `apply` nas três |

Tudo passa pela `main`, de propósito: os rulesets do repositório são a proteção
que impede qualquer uma das outras branches de fazer o que quiser, e os nomes
de DNS e o bucket de backup são de produção — não existe um DNS de `dev`.

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
export TF_VAR_cloudflare_zone_id=… TF_VAR_vps_ipv4=…

cat > backend.hcl <<'EOF'
bucket    = "nekolog-tfstate"
endpoints = { s3 = "https://<account>.r2.cloudflarestorage.com" }
EOF

tofu -chdir=infra/vps init -backend-config=../../backend.hcl
tofu -chdir=infra/vps plan
```

`backend.hcl` e qualquer `*.tfvars` estão no `.gitignore`. Os
`.terraform.lock.hcl` **não** estão: eles fixam o hash de cada provider, e o CI
falha se um deles mudar sozinho.

## Saídas

`infra/vps` devolve `names`, `proxied`, `backup_bucket` e
`backup_expiring_prefix`. `infra/email` devolve `send_domain` e `dmarc`.
