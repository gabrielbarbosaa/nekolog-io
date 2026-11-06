# @apps/dashboard

O dashboard. Next.js 16 (App Router), Tailwind v4, tema Grafite, três idiomas.

```bash
pnpm --filter @apps/dashboard dev     # :3001
pnpm --filter @apps/dashboard build
pnpm --filter @apps/dashboard test
```

Nasceu aqui na ADR [0019](../../docs/adr/0019-um-repositorio-so.md). Até
06/11/2026 ele seria um repositório separado; a divisão existia porque este era
público sob MIT, e isso acabou.

## O que já está ligado

Tema (claro, escuro, do sistema), idioma (`en`, `pt-BR`, `es` por cookie
`NEKOLOG_LOCALE`, sem prefixo na URL), cabeçalhos de segurança com nonce por
resposta, e `/health`. As telas chegam uma etapa por vez, a partir da 2.5.

A página inicial é a moldura com um texto honesto sobre o que falta. Ela sai na
2.17, quando o Explorer entra — foi o que o `apps/web` fez até a 6.8.

## Cinco regras de desenho

Não são preferências: cada uma corrige algo que os mockups da 2.1 erraram, e a
skill `frontend-design` nomeia três delas como marcas de página gerada.

**Cor significa nível ou ambiente. O chrome é acromático.** Num leitor de logs a
cor pertence ao dado — `--level-*` e `--env-*`. Botão primário, item de navegação
ativo e foco usam o neutro. Se algo colorido não é um nível nem um ambiente, está
errado.

**Mono significa "isto alinha com a linha de baixo".** Timestamp, id, nível,
trecho de código e a linguagem de busca. **Nunca um rótulo**: mono em rótulo
pequeno é decoração, e a skill lista isso como marca.

**Uma borda é uma fronteira, não um grupo.** Entre navegação e conteúdo, entre a
barra e os resultados, em volta de um painel que é outra superfície. Não em volta
de cada conjunto de campos — foi o que transformou os mockups num tabuleiro de
cards idênticos.

**A consulta é um objeto só.** Ambiente, período e busca ficam juntos, numa barra
só, logo acima do que eles filtram. Os mockups espalharam os três em três
lugares; são três partes do mesmo ato.

**Densidade é recurso.** A escala tipográfica é fechada — `text-data` (13px) é o
corpo *e* a linha de log. Uma barra, não duas. Sem rótulo em caixa alta, sem
`A · B · C`.

## A armadilha do `cn()`

`text-data`, `text-aside`, `text-section` e `text-screen` são tamanhos, e o
`tailwind-merge` não conhece token customizado: sem configuração ele os
classifica como **cor** e descarta `text-muted-foreground` como conflito. O
rótulo some da tela e nada avisa.

`lib/utils.ts` estende o merge com esses quatro, e `lib/utils.test.ts` falha nos
dois sentidos: se um tamanho e uma cor pararem de conviver, e se a lista do merge
divergir dos `--text-*` que o `globals.css` declara.

## O tema não é uma cópia solta

`app/globals.css` começa com o conteúdo literal de
[`docs/tema/globals.css`](../../docs/tema/globals.css) e só então acrescenta a
escala tipográfica. `apps/web/tests/theme.test.ts` compara os blocos `:root` e
`.dark` de toda cópia com o arquivo canônico e falha nos dois sentidos — mude a
cor lá, não aqui.

## Testes

`i18n/messages.test.ts` falha se uma chave some, fica em branco, continua em
inglês, ou se um valor grita em caixa alta. A lista de exceções só aceita
substantivo de produto e a linguagem de busca, com teste de que ninguém põe uma
frase nela.

`tests/headers.integration.test.ts` sobe o servidor de produção de verdade e
confere cabeçalho, nonce por resposta, todo `<script>` alcançado pelo nonce, e
que **nenhum atributo `style`** apareça — nonce não alcança atributo de estilo.
Ele é pulado sem build; `DASHBOARD_HEADERS_TEST_REQUIRED=1` transforma o pulo em
falha, que é o que o CI faz.
