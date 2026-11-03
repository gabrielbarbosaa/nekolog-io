# @internal/security-headers

Os cabeçalhos de segurança da seção 14 do [PLANO](../../docs/PLANO.md) — CSP com
nonce, HSTS com preload, `frame-ancestors 'none'`, `Referrer-Policy`,
`Permissions-Policy` e `X-Content-Type-Options` — num lugar só, porque os dois
sites deste repositório precisam da mesma lista e porque uma política escrita
duas vezes diverge na terceira mudança.

```ts
const headers = securityHeaders({
  scriptSources: [nonceSource(newNonce())],
  strictDynamic: true,
})
```

## As duas metades do CSP

**`script-src` nunca ganha `'unsafe-inline'` nem `'unsafe-eval'`**, e não há
opção para isso. Quem precisa de script inline manda o nonce ou o hash dele.

O resto fecha as saídas que sobram quando o `script-src` segura: `base-uri
'none'` (senão um `<base>` injetado reaponta todo caminho relativo),
`object-src 'none'`, `form-action 'self'` e `default-src 'self'` para qualquer
diretiva que ninguém listou.

**Uma fonte não pode carregar espaço, ponto e vírgula, vírgula ou quebra de
linha.** Sem isso, um valor vindo de configuração viraria uma segunda fonte ou
uma segunda diretiva dentro do mesmo cabeçalho.

## Nonce num lado, hash no outro

| | `apps/web` | `apps/docs` |
|---|---|---|
| Como é servido | Next, resposta por requisição | Astro, arquivos estáticos |
| `script-src` | `'self' 'strict-dynamic' 'nonce-…'` | `'self'` + um hash por script |
| Quem monta | `apps/web/proxy.ts`, a cada resposta | `apps/docs/scripts/headers-cli.ts`, no build |

Site estático não tem como ter um nonce por requisição: o arquivo é o mesmo para
todo mundo. Então lá a política é feita de hashes, gerados do `dist/` e gravados
no `vercel.json` — e o `build` falha se o que está gravado não cobrir mais o que
o build produziu.

`'strict-dynamic'` só entra quando pedido, e só serve ao lado do nonce: ele faz
o navegador **ignorar** `'self'` para script, então num site estático, onde os
`<script src>` vêm do HTML e não de um script confiável, ele bloquearia tudo.

## O que o Next 16 realmente lê

A documentação do Next manda repassar o CSP nos cabeçalhos da **requisição**
para ele colocar o nonce nos próprios `<script>`. Medimos: na 16.4 isso não é o
que acontece — o nonce sai do CSP da **resposta** do `proxy.ts`, e remover o
repasse não muda nada (13 de 13 tags continuam com nonce). A linha foi removida
em vez de ficar lá parecendo carregar peso que não carrega.

O que o `proxy.ts` repassa na requisição é o `x-nonce`, que o `layout.tsx` lê
para dar ao `next-themes` — o script de tema roda antes da primeira pintura e
precisa do nonce para não ser bloqueado.

## Atributo `style` não é alcançável

Nem nonce nem hash cobrem `style="…"` num elemento; só `'unsafe-inline'`. O
`apps/web` não escreve nenhum, e **há teste que falha se alguém escrever** — do
contrário a página só ficaria torta no navegador, sem ninguém saber. O
`apps/docs` tem centenas, vindos do Starlight, e por isso aceita
`'unsafe-inline'` em `style-src`; está registrado no [modelo de
ameaças](../../docs/security/threat-model.md) como risco aceito.

## Testes

```bash
pnpm --filter @internal/security-headers test   # a política e o leitor de HTML
pnpm --filter @apps/web test                    # sobe o next start de verdade
pnpm --filter @apps/docs test                   # confere o vercel.json contra o dist/
```

Os dois últimos precisam do build feito antes. Sem ele avisam no stderr e pulam;
no CI as variáveis `WEB_HEADERS_TEST_REQUIRED` e `DOCS_HEADERS_TEST_REQUIRED`
transformam o pulo em falha, que é por que o passo de build vem **antes** do de
teste no `ci.yml`.
