# @nekolog-io/config

As variáveis de ambiente de cada app do NekoLog, descritas em Valibot e
carregadas de um jeito só. Implementa a
[especificação 2](../../docs/ESPECIFICACOES.md#2-variáveis-de-ambiente-e-segredos):
toda variável existe nos três ambientes, cada app valida as suas na
inicialização e **não sobe se faltar alguma**.

```ts
import { loadEnv, migrationsEnvSchema } from '@nekolog-io/config'

const env = loadEnv('migrations', migrationsEnvSchema)
```

Faltando algo, `loadEnv` lança um `EnvValidationError` que lista **todos** os
problemas de uma vez, com o caminho de cada um. Parar no primeiro faria você
descobrir as variáveis que faltam uma por deploy.

## Vazio conta como ausente

`withoutBlanks` tira do objeto toda variável que seja `undefined` ou só espaço
antes de validar. Isso existe porque um `.env` com `CLICKHOUSE_DB=` e um `.env`
sem a linha nenhuma são a mesma intenção, e porque um CI que exporta um segredo
não configurado entrega string vazia, não ausência — sem isso, uma credencial em
branco passaria pela validação e falharia bem mais tarde, na conexão.

## Os schemas são anotados à mão, de propósito

Cada schema exportado carrega uma anotação explícita
(`v.GenericSchema<unknown, MigrationsEnv>`) e o tipo de saída é escrito à mão,
em vez de sair de `v.InferOutput`. O motivo é o `isolatedDeclarations`: desde o
TypeScript 7 as declarações são emitidas pelo Oxc, que não infere o tipo de uma
expressão Valibot. O efeito colateral é bom — o contrato de ambiente de cada app
virou um tipo legível, em vez de um blob inferido.

Mexendo num schema, mexa no tipo junto: o compilador confere que o schema
produz algo atribuível ao tipo, então ele pega o caso perigoso (o tipo promete
um campo que o schema não valida).

## Publicado no npm

Este pacote é publicado como `@nekolog-io/config` porque o
[`nekolog-dashboard`](https://github.com/gabrielbarbosaa/nekolog-dashboard),
que é um repositório privado, valida o ambiente dele com o mesmo `webEnvSchema`
(ADR [0016](../../docs/adr/0016-pacotes-compartilhados-no-npm.md)).

Ele existe para ser compartilhado entre os dois repositórios do NekoLog, não
como uma API pública de uso geral — mas o semver vale do mesmo jeito, e mudança
incompatível vira major.

**Dentro deste repositório ele resolve pelo fonte**, não pelo `dist/`: o
`exports` do `package.json` aponta para `./src/index.ts` e o mapeamento para
`dist/` fica no `publishConfig`, que o `pnpm pack` aplica na hora de publicar.
É o que deixa `pnpm ch:migrate` e `pnpm seed` rodarem `.ts` direto, sem build.
