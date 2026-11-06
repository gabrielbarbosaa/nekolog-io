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

## Não vai ao npm

Este pacote é `private: true` e nunca é publicado — ADR
[0019](../../docs/adr/0019-um-repositorio-so.md). A ADR
[0016](../../docs/adr/0016-pacotes-compartilhados-no-npm.md) o tinha publicado
porque o dashboard vivia noutro repositório e precisava instalá-lo; o dashboard
veio para cá, e publicar um pacote de servidor de um produto proprietário
passou a ser entregar o que o produto é.

**Ele resolve pelo fonte**: o `exports` do `package.json` aponta para `./src/`,
que é o que deixa os CLIs e os apps carregarem `.ts` direto, sem build. Não há
mais `publishConfig`, `files`, `build` nem `lint` — tudo isso existia só para
empacotar um tarball e conferi-lo com `publint` e `attw`.

