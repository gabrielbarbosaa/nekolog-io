---
title: Plugin de bundler
description: Registra a release e sobe os source maps no fim de todo build de produção, no Vite, no webpack, no Rollup ou no esbuild.
---

:::caution[Ainda não está no npm]
Os pacotes `@nekolog-io/*` ainda não foram publicados. Esta página descreve o
comportamento que o código já tem, para a forma da API ficar clara.
:::

O `@nekolog-io/bundler-plugin` faz de dentro do build o que
[`nekolog releases create` e `nekolog sourcemaps upload`](/docs/pt-br/guides/cli/)
fazem de um script de deploy — então ninguém precisa lembrar de rodar nada, e
os mapas que sobem são exatamente os que o build acabou de escrever.

```ts
import nekolog from '@nekolog-io/bundler-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), nekolog()],
  build: { sourcemap: true },
})
```

Tem uma entrada por bundler, e todas são o mesmo plugin — é
[`unplugin`](https://unplugin.unjs.io/) por baixo:

```ts
import nekolog from '@nekolog-io/bundler-plugin/vite'
import nekolog from '@nekolog-io/bundler-plugin/webpack'
import nekolog from '@nekolog-io/bundler-plugin/rollup'
import nekolog from '@nekolog-io/bundler-plugin/esbuild'
```

O seu bundler precisa estar gerando source map — `sourcemap: true` no Vite e no
Rollup, `devtool: 'source-map'` no webpack, `sourcemap: true` no esbuild. O
plugin sobe o que encontrar; ele não liga a geração de mapa por você.

## Configuração

Tudo pode vir do ambiente, que é o que um job de CI já tem.

| Opção | Ambiente | |
|---|---|---|
| `key` | `NEKOLOG_KEY` | a key **secreta** do ambiente |
| `release` | `NEKOLOG_RELEASE` | a versão que está saindo |
| `commit` | `NEKOLOG_COMMIT`, `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA`, `CI_COMMIT_SHA` | 7 a 40 hexadecimais minúsculos |
| `apiUrl` | `NEKOLOG_API_URL` | onde a API pública responde |
| `dir` | — | o que varrer, quando o bundler não disser |
| `deleteAfterUpload` | — | apaga do build os mapas que subiram (padrão: não) |
| `disable`, `silent` | — | desliga, ou cala |

Um commit que você passa tem que estar certo, e o plugin derruba o build se não
estiver. Um commit que ele apenas *encontrou* numa dessas variáveis de CI é
melhor esforço: se o `GITHUB_SHA` trouxer uma referência de branch, a release é
registrada sem commit em vez de quebrar o seu deploy.

## Duas regras decidem tudo

**Sem key ele não faz nada e diz isso numa linha.** É o que um build local
parece — ninguém tem key secreta na própria máquina, e um build que falhasse
por isso seria insuportável.

**Com key, qualquer outra coisa errada derruba o build.** Key pública, versão
faltando, commit digitado torto, `http://` puro para fora desta máquina, mapa
que a API recusou — tudo isso é erro, não aviso. Uma release registrada *sem*
os mapas é exatamente o problema que este plugin existe para evitar, e descobrir
isso pelo stack trace minificado de um erro em produção é tarde demais.

## O que ele nunca faz

**Nunca encosta no seu código.** O plugin não tem `transform`, não tem `load` e
não tem `resolveId` — só `writeBundle`. Ele não tem como escrever a key secreta
dentro do bundle para o qual está subindo os mapas, e tem teste que falha se
esses hooks aparecerem.

**Nunca roda no servidor de desenvolvimento.** No Vite ele é `apply: 'build'`,
ou cada reload viraria um upload.

**Nunca estoura enquanto a config é lida.** Nada é validado na hora de montar o
plugin, só no fim do build, então uma key errada no `.env` não impede o
`vite dev` de subir.

**Nunca sobe duas vezes.** Em modo watch, ou num build que escreve mais de uma
vez, ele sobe uma vez por processo.

**Nunca apaga um mapa que não subiu.** Com `deleteAfterUpload` ele remove só os
arquivos cujo nome a API confirmou — um mapa acima do limite de tamanho, que o
upload pulou, fica onde está, porque ninguém mais tem cópia dele.

## Onde ele procura os mapas

Ele aprende o diretório com o próprio bundler: `build.outDir` no Vite,
`output.path` no webpack, `outdir` ou `outfile` no esbuild, `dir` ou `file` no
Rollup. Um `dir` explícito ganha de todos; sem nada disso, `dist`.

Ele **não** remove o comentário `//# sourceMappingURL=` dos arquivos gerados,
nem com `deleteAfterUpload`. Isso exigiria reescrever a saída do build, e o
preço de deixar é um 404 no devtools de quem abrir o arquivo — não um erro.

## Num webpack config em CommonJS

O pacote é ESM. Num `webpack.config.js` que ainda é CommonJS, uma config
assíncrona resolve:

```js
module.exports = async () => ({
  devtool: 'source-map',
  plugins: [(await import('@nekolog-io/bundler-plugin/webpack')).default()],
})
```

## Depois

O [guia da CLI](/docs/pt-br/guides/cli/) cobre as mesmas duas operações como
comandos, que é o que você quer quando o build e o deploy são jobs diferentes.
