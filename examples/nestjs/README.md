# examples/nestjs

Um app Nest pequeno que manda log de verdade. Mesma história do
[`examples/express`](../express/README.md), com o módulo e o interceptor do
[`@nekolog-io/nestjs`](../../packages/nestjs/README.md).

```bash
pnpm dev:infra          # ClickHouse
pnpm seed init          # uma key para usar
pnpm --filter @apps/ingest serve
pnpm --filter @examples/nestjs build
NEKOLOG_KEY=nekolog_sk_... NEKOLOG_ENDPOINT=http://localhost:8787 \
  pnpm --filter @examples/nestjs start

curl localhost:3101/orders/ord_7f3a91
```

## Este roda do build, e não do fonte

Os outros exemplos o Node roda direto, em `.ts`. Este não: o Nest idiomático
usa decorator, e o *type stripping* do Node 24 não aceita decorator — ele só
apaga tipo, não transforma sintaxe. Então aqui tem `tsdown` e o `start` roda
`dist/main.mjs`, que é como um app Nest de verdade é publicado de todo jeito.

É por isso também que o `biome.json` liga
`unsafeParameterDecoratorsEnabled` só para esta pasta: `@Inject(...)` num
parâmetro é sintaxe de decorator legado, que o Biome não parseia por padrão.

## O que dá para conferir

O teste de integração sobe ingestão e exemplo de verdade e **consulta o
ClickHouse**: a linha do controller, as duas linhas sob o mesmo `trace_id` que
o chamador começou, o e-mail do cliente saindo como `[redacted]` com o
`user_id` ainda preenchido, e o `/boom` virando erro com a pilha guardada e o
endereço interno **fora** da resposta HTTP.

Foi escrevendo este exemplo que apareceu uma lacuna no pacote: o interceptor
logava a linha de acesso de um 500 mas **não o erro**, então a pilha não ia
parar em lugar nenhum. Agora loga os dois, e `errorLog: false` desliga.
