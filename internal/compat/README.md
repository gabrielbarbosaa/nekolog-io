# @internal/compat

O teste de fumaça que a matriz de compatibilidade roda. Um arquivo só,
`dist/smoke.mjs`, com os SDKs **embutidos** — Node 22, 24 e 26, Bun e Deno
rodam exatamente esse arquivo.

```bash
pnpm --filter @internal/compat... run build
node internal/compat/dist/smoke.mjs
```

## Por que um bundle, e não os pacotes

A pergunta da matriz é "o que foi publicado roda neste runtime", não "o
monorepo compila". Então o smoke importa os pacotes, o `tsdown` embute tudo
num arquivo, e cada runtime executa esse arquivo direto — sem resolução de
`node_modules`, sem *type stripping*, sem nada que seja do repositório e não
do SDK.

É também por isso que ele não é um teste de vitest: o Bun e o Deno rodariam o
vitest, não o SDK.

## O que ele confere

Que o SDK de Node manda um lote com a forma do contrato (versão do esquema,
`batchId` em UUID, nome do SDK, runtime, serviço, tipo e pilha do erro, e a
key secreta **no header**); que o de browser se declara `browser`, abre
sessão e respeita o nível; que uma key **secreta** num browser é recusada e
nada sai; que o `traceparent` de quem chamou continua com span novo; e que
`uuidv7` tem entropia de verdade naquele runtime.

Qualquer coisa que falhe sai com a lista do que quebrou e código diferente de
zero.

Foi escrevendo este arquivo que apareceu um buraco: o SDK de browser
**ignorava em silêncio** um `transport.fetch`, porque monta o próprio sender
para o `sendBeacon`. Agora aceita os dois.
