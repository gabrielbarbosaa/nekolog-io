# @internal/deploy

O que separa a configuração do `wrangler` que fica no repositório dos valores
que só existem dentro da conta da Cloudflare.

## O problema

O `wrangler.json` precisa do id do namespace KV e do nome do bucket R2. Eles não
são segredos, mas também não existem aqui — nascem do `tofu apply`. E o
`wrangler` **não** interpola variável de ambiente dentro do arquivo de
configuração: o que está escrito lá é o que vai.

Então o arquivo versionado carrega marcadores, e o deploy escreve um arquivo
resolvido ao lado:

```json
"kv_namespaces": [{ "binding": "KEYS", "id": "${KV_NAMESPACE_ID}" }]
```

```bash
node internal/deploy/src/render-cli.ts \
  --config apps/ingest/wrangler.json \
  --environment dev \
  --out apps/ingest/wrangler.generated.json
```

O `wrangler.generated.json` está no `.gitignore`.

## O resultado tem um ambiente só

O `render` **apaga os outros ambientes** do arquivo que escreve. Isso não é
economia: é o que torna impossível publicar `prod` com os valores de `dev`. O
workflow roda com os segredos e as variáveis de um *environment* do GitHub por
vez, então só um conjunto de valores está disponível — e se alguém passar
`--env prod` num arquivo renderizado para `dev`, o `wrangler` não acha o
ambiente e para.

Faltando um valor, o comando falha dizendo **quais** faltam, antes de qualquer
chamada à Cloudflare. Um valor em branco conta como faltando: um binding vazio
publica um Worker que só quebra no primeiro request.

## Os segredos vêm por outro caminho

Marcador serve para valor que pode aparecer num arquivo. Senha, não. Os nomes
dos segredos de cada app estão em
[`deploy/workers/secrets.json`](../../deploy/workers/secrets.json), e o workflow
faz:

```bash
printf '%s' "$ALL_SECRETS" | node internal/deploy/src/secrets-cli.ts \
  --app ingest --out "$RUNNER_TEMP/secrets-ingest.json"
wrangler secret bulk "$RUNNER_TEMP/secrets-ingest.json" --env dev
```

`$ALL_SECRETS` é o `toJSON(secrets)` do Actions — tudo que o runner tem. O CLI
escolhe só o que o app declarou, com permissão `0600`, e o passo apaga o arquivo
no fim.

Nenhum valor aparece em mensagem nenhuma, nem em erro. Isso tem um teste, e ele
cobre o caso que não é óbvio: `JSON.parse` do Node devolve o próprio texto na
mensagem quando a entrada não começa como JSON — `JSON.parse('senha')` responde
`Unexpected token 's', "senha" is not valid JSON`. Por isso o erro de parse da
entrada padrão é substituído por um genérico.

## O que é conferido antes de publicar

`apps/ingest/src/wrangler.test.ts` e `apps/jobs/src/wrangler.test.ts` montam o
`env` que a configuração produziria e passam para o `assertEnv` do próprio
Worker. Se alguém tirar um binding do `wrangler.json`, ou tirar um segredo do
manifesto, o teste falha aqui — não em produção, no primeiro request.

`src/deployment.test.ts` amarra o que está em dois lugares: os hostnames do
plano, o `service` que o domínio no OpenTofu aponta e o `name` que o `wrangler`
publica.

E o workflow `Workers` roda `wrangler deploy --dry-run` nos três ambientes em
todo PR. Ele compila o Worker de verdade, então um import quebrado ou um bundle
que não fecha falham ali, sem conta nenhuma.
