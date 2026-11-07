# A marca

O gato enrolado. Esta pasta é a fonte: os aplicativos carregam **cópias byte a
byte** do que está aqui, e `internal/release/src/brand.test.ts` falha se alguma
divergir — mesmo arranjo do tema em [`docs/tema/`](../tema/globals.css).

## Os arquivos

| Arquivo | O que é | Onde usar |
|---|---|---|
| `nekolog-dark.png` | o original, 891×977 | arquivo de origem; não é servido |
| `nekolog-light.png` | o original invertido, 891×977 | arquivo de origem; não é servido |
| `logo-dark.png` | 256×281 | **fundo claro** |
| `logo-light.png` | 256×281 | **fundo escuro** |
| `icon.png` | 512×512 | aba do navegador, atalho, favicon |

**O nome diz o gato, não o fundo.** `logo-dark.png` é o gato escuro, então ele
vai no tema claro; `logo-light.png` é o gato claro, e vai no escuro. Quem troca
é o CSS (`block dark:hidden` e `hidden dark:block`), não o JavaScript — assim a
marca certa já vem no primeiro quadro, sem piscar.

O `icon.png` é o gato claro sobre `#18181b`, com margem. Ele é quadrado e tem
fundo próprio de propósito: um PNG transparente some na barra de abas escura de
um navegador e de novo na clara.

## O que ainda falta

**Não há versão vetorial.** O que existe é PNG, e foi dele que saíram os
tamanhos acima. Um `.svg` renderizaria melhor em tela grande e pesaria menos;
quando existir, ele entra aqui e os tamanhos são gerados de novo a partir dele.

Também não há variante horizontal (gato + palavra numa imagem só). Hoje a
palavra é texto ao lado da imagem, que é melhor para leitor de tela e para
tradução, então isso não é urgente.
