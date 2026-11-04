# @nekolog-io/bundler-plugin

```ts
import nekolog from '@nekolog-io/bundler-plugin/vite'

export default defineConfig({
  plugins: [react(), nekolog()],
  build: { sourcemap: true },
})
```

No fim de todo build de produção ele faz as duas coisas que a CLI faz, sem
ninguém lembrar de rodar nada: registra a release e sobe todo `.map` que o
bundler acabou de escrever.

Tem uma entrada por bundler, e todas levam ao mesmo plugin — é `unplugin` por
baixo:

```ts
import nekolog from '@nekolog-io/bundler-plugin/vite'
import nekolog from '@nekolog-io/bundler-plugin/webpack'
import nekolog from '@nekolog-io/bundler-plugin/rollup'
import nekolog from '@nekolog-io/bundler-plugin/esbuild'
```

| | | |
|---|---|---|
| `key` | `$NEKOLOG_KEY` | a key **secreta** do ambiente |
| `release` | `$NEKOLOG_RELEASE` | a versão que está saindo |
| `commit` | `$NEKOLOG_COMMIT`, `$GITHUB_SHA`, `$VERCEL_GIT_COMMIT_SHA`, `$CI_COMMIT_SHA` | 7 a 40 hexadecimais minúsculos |
| `apiUrl` | `$NEKOLOG_API_URL` | onde a API responde |
| `dir` | — | o que varrer, se o bundler não disser |
| `deleteAfterUpload` | — | apaga do build os mapas que subiram (padrão: não) |
| `disable` / `silent` | — | desliga, ou cala |

## As duas regras que decidem tudo

**Sem key, ele não faz nada e diz isso numa linha.** É o build local: ninguém
tem key na máquina e um build que falha por isso seria insuportável.

**Com key, qualquer outra coisa errada derruba o build.** Key pública, versão
que falta, commit digitado torto, `http://` para fora desta máquina, mapa que a
API recusou — tudo isso é erro, não aviso. Uma release registrada *sem* os
mapas é exatamente o problema que este plugin existe para evitar, e descobrir
isso pelo stack trace minificado de um erro de produção é tarde demais.

## O que ele nunca faz

**Não encosta no seu código.** O plugin não tem `transform`, `load` nem
`resolveId` — só `writeBundle`. Ele literalmente não tem como escrever a key
secreta dentro do bundle que está subindo os mapas. Tem teste conferindo que
esses hooks continuam ausentes.

**Não roda no servidor de desenvolvimento.** No Vite ele é `apply: 'build'`, ou
cada reload viraria um upload.

**Não quebra enquanto a config é lida.** Nada é validado na hora de montar o
plugin, só no fim do build — uma key errada no `.env` não pode impedir o
`vite dev` de subir.

**Não sobe duas vezes.** Em modo watch, ou num build que escreve mais de uma
vez, ele sobe uma vez por processo.

**Não apaga mapa que não subiu.** Com `deleteAfterUpload`, ele apaga só os
arquivos cujo nome a API confirmou — um mapa grande demais, que o upload pulou,
fica onde está, porque ninguém tem cópia dele.

## Achar o build

Ele aprende o diretório com o próprio bundler: `build.outDir` no Vite,
`output.path` no webpack, `outdir`/`outfile` no esbuild, `dir`/`file` no
Rollup. `dir` ganha de todos; sem nada disso, `dist`.

Ele **não** remove o `//# sourceMappingURL=` dos arquivos gerados, nem com
`deleteAfterUpload`: isso exigiria reescrever a saída do build, e o preço é um
404 no devtools de quem abrir o arquivo, não um erro.

## ESM

O pacote é ESM, como o resto dos internos daqui. Num `webpack.config.js` que
ainda é CommonJS, a config assíncrona resolve:

```js
module.exports = async () => ({
  plugins: [(await import('@nekolog-io/bundler-plugin/webpack')).default()],
})
```
