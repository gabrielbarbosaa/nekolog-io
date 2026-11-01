# @internal/seed

Cria organização, projeto, ambientes e keys **antes de existir o dashboard**.
Sem isso não dá para mandar um log de verdade, porque a ingestão só conhece quem
tem key, e quem cria key é o dashboard — que ainda não existe.

```bash
pnpm seed init                          # organização, projeto, 3 ambientes, 6 keys
pnpm seed init --origins https://app.exemplo.com
pnpm seed add-key --environment production --kind secret
pnpm seed show                          # o que existe, sem segredo nenhum
```

## O arquivo não guarda a key

A seção 6 do plano é explícita: só o hash SHA-256 é guardado e a key aparece uma
única vez. O `.nekolog-seed.json` segue isso — ele tem os ids, os hashes e uma
**dica** (`nekolog_pk_…0B7T`) que serve para saber qual key é qual, e nada mais.
O segredo sai uma vez no stdout, e acabou.

O `parseSeedDocument` **recusa** um documento que traga um campo `value`, para o
dia em que alguém "facilitar" isso e o arquivo passar a ser um cofre sem
cadeado.

## Perdeu a key? Gera outra

É para isso que serve o `add-key`, que é a mesma coisa que a rotação que o plano
pede ("várias keys por ambiente, para rotacionar sem downtime"). A key antiga
continua valendo até ser revogada, então dá para trocar quem usa uma de cada
vez.

O `init` **recusa** sobrescrever um arquivo existente. Sobrescrever mintaria ids
novos, e o `project_id` e o `environment_id` já estão gravados em cada linha do
ClickHouse — o que estava lá viraria órfão. O `--force` existe para quando é
mesmo isso que você quer.

## Ids

`org_`, `prj_`, `env_` e `key_` seguidos de um ULID. ULID porque ele ordena por
tempo como texto puro, o que torna "os mais recentes" uma consulta de prefixo em
vez de uma coluna extra.

A aleatoriedade vem de `crypto.getRandomValues` mapeada no alfabeto Crockford
(32 símbolos, sem `I`, `L`, `O` e `U`, que se confundem ao ler em voz alta ou
copiar à mão). Cada byte vira um símbolo por `% 32` — **sem viés**, porque 32
divide 256 exatamente. Tem teste varrendo os 256 bytes e conferindo que cada
símbolo sai 8 vezes.

## Padrões, e por que eles

| O quê | Padrão | Por quê |
|---|---|---|
| Ambientes | `production`, `staging`, `development` | seção 6 do plano |
| Retenção | 7 dias | é a cota da instância hospedada (seção 20) |
| Escopos da `pk` | `logs:write` | key pública fica visível no site; ler log com ela seria vazamento |
| Escopos da `sk` | `logs:write`, `logs:read` | é a key de servidor |
| Origens | qualquer uma | não dá para adivinhar o domínio de quem está semeando |

O último é o incômodo: uma key pública que aceita qualquer origem é uma key que
qualquer pessoa copia do seu site e usa por `curl`. O `init` avisa isso em voz
alta e o `--origins` resolve. Recusar tudo por padrão seria pior — a key nasceria
inútil e a pessoa só descobriria no primeiro `403`.

## Onde as keys vão parar

Por enquanto, no arquivo. O `keyRecordsFor` transforma o documento nos
`KeyRecord` que a ingestão espera, e o `keyStoreFromDocument` monta um
`KeyStore` de memória com eles — é assim que o teste de integração manda um log
de verdade.

**Ainda não existe escrita no KV da Cloudflare**, porque ainda não existe
namespace nenhum: ele é criado pelo OpenTofu na etapa 1.16. Quando existir, o
mesmo `keyRecordsFor` alimenta um `kvKeyStore` sem mudar nada aqui. Escrever
agora um adaptador contra um serviço inalcançável seria código que ninguém
conseguiria conferir.

## Testes

```bash
pnpm --filter @internal/seed test
```

O que prova que isto funciona não está aqui, está em
`apps/ingest/tests/seed.integration.test.ts`: ele semeia, monta a ingestão de
verdade com o `KeyStore` do seed, manda um log por HTTP e confere a linha no
ClickHouse — inclusive que a key de `staging` grava em `staging`, que a key
pública é recusada fora das origens permitidas, e que uma key de outro seed
recebe `401`.
