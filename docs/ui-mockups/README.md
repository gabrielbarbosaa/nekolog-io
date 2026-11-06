# Mockups do dashboard — etapa 2.1

Abra [`index.html`](index.html) no navegador. Não há build, não há servidor e
nada é baixado da rede.

São HTML e CSS puros porque o que precisa de aprovação é o **desenho**, não a
implementação: o que cada tela mostra, onde, e com que palavra. Nenhum botão
funciona e nenhum campo envia — os campos estão em `readonly` de propósito.

| Arquivo | Rota do mapa de telas (plano, seção 10.1) |
|---|---|
| [`login.html`](login.html) | `/login`, `/login/code`, `/demo` |
| [`explorer.html`](explorer.html) | `…/logs`, com o detalhe em `?log=…` |
| [`issues.html`](issues.html) | `…/issues` e `…/issues/[id]` |
| [`keys.html`](keys.html) | `…/settings` → keys |
| [`first-log.html`](first-log.html) | `…/setup` |
| [`estados.html`](estados.html) | os cinco estados que toda tela precisa ter |

As cinco primeiras são as que a etapa 2.1 nomeia. A sexta existe porque a
seção 10.1 termina exigindo carregando, vazio, erro, sem permissão e cota
estourada em **toda** tela, e isso é desenho que precisa de aprovação como
qualquer outro.

## O tema não é uma terceira cópia

`tokens.css` é cópia literal dos blocos `:root` e `.dark` de
[`docs/tema/globals.css`](../tema/globals.css), que é a fonte canônica do tema
Grafite. `apps/web/tests/theme.test.ts` extrai os dois blocos do arquivo
canônico e falha se qualquer cópia — a do `apps/web` ou esta — sair de sincronia,
em qualquer direção. Para mudar uma cor, mude o `docs/tema/globals.css` e rode
o teste: ele diz exatamente qual cópia ficou para trás.

O resto do `mockup.css` é layout escrito à mão. Ele **não** é Tailwind e não vira
código do dashboard: o dashboard usa Tailwind v4 e shadcn/ui, e estas páginas
existem para serem jogadas fora quando as telas de verdade chegarem.

A fonte é a do sistema. O tema usa Geist, que precisaria vir da rede ou de um
build, e para julgar espaçamento e cor isso não muda nada.

## O que foi decidido desenhando

Algumas coisas só aparecem quando se desenha a tela, e estão nos mockups de
propósito:

- **A key decide o ambiente**, então o erro mais comum do primeiro dia é mandar
  log com a key de `production` olhando `development`. O `…/setup` tem um estado
  só para isso.
- **A key aparece uma vez.** O banco guarda só o hash SHA-256, então a janela de
  criação precisa dizer isso com todas as letras, e o aviso de "secreta é só no
  servidor" fica ao lado do valor, não num texto de ajuda.
- **O desvio de relógio é informação de tela.** Acima de 5 min o detalhe do log
  mostra o horário que o cliente mandou, porque `timestamp` pode ter sido
  limitado na ingestão.
- **Cota estourada é aviso de topo em toda tela do projeto**, não um número na
  tela de uso: quem está investigando um erro precisa saber que faltam eventos.
- **O erro de login é uma frase só** para e-mail inexistente e senha errada.
- **O conteúdo do log é texto, nunca HTML.** Está escrito no painel de detalhe
  porque é a tela onde alguém teria a ideia de renderizar.

## O que ainda não tem mockup

Traces, dashboards customizáveis, alertas, releases, exportações, membros e
papéis, uso e cotas, audit log, conta e área do operador. Cada uma tem etapa
própria no [`ETAPAS.md`](../ETAPAS.md); estas seis são as que a 2.1 pede para
destravar o resto.
