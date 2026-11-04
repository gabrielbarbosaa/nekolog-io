---
title: Alertas
description: Regras avaliadas a cada minuto, e os canais que elas alcançam — incluindo como conferir que um webhook veio mesmo do NekoLog.
---

:::caution[Ainda não está no npm]
Os pacotes `@nekolog-io/*` ainda não foram publicados, e ainda não há instância
hospedada. Esta página descreve o comportamento que o código já tem, para a
forma da API ficar clara.
:::

Uma regra é uma [busca](/docs/pt-br/api/search/), uma janela e um limite. A cada
minuto um job mede cada regra de cada ambiente e, quando a resposta cruza, manda
um aviso para os canais que a regra nomeia. Você cria as regras no dashboard; o
que vem abaixo é o que roda.

## Os cinco tipos

| Tipo | Dispara quando |
|---|---|
| `threshold` | a contagem de logs que casam a busca, na janela, passa do valor |
| `error_rate` | a fatia de `error` e `fatal` na janela passa do valor, acima de um piso `minEvents`, para um serviço quieto não alertar por uma linha |
| `new_issue` | uma issue aparece no ambiente pela primeira vez |
| `issue_regression` | uma issue que estava resolvida acontece de novo |
| `absence` | **nada** que case a busca chegou durante a janela — um serviço que parou de reportar |

As janelas são `1m`, `5m`, `15m` ou `1h`.

```json
{
  "type": "threshold",
  "query": "level:error service:api",
  "window": "5m",
  "operator": ">",
  "value": 50,
  "cooldown": "30m",
  "channels": ["ch_01J9X…"]
}
```

A condição **não carrega ambiente**. O ambiente é uma coluna da regra, e é
metade da chave estrangeira que impede uma regra de um projeto apontar para o
ambiente de outro. Uma segunda cópia dentro do JSON seria uma segunda verdade
que nenhuma constraint alcança, então ela é recusada.

## Disparar, e parar

Uma regra guarda dois estados, `ok` e `firing`. "Resolvido" é a volta para `ok`,
e ele também manda aviso — ser avisado de que algo quebrou e nunca ser avisado
de que consertou é pior que uma mensagem a mais.

O `cooldown` segura a **repetição do aviso de disparo**, contada a partir do
último aviso de disparo que realmente saiu. Ele nunca segura o aviso de que
acabou. Um aviso segurado ainda é registrado, marcado como suprimido, para a
tela poder dizer por que ninguém foi avisado.

Três recusas que valem saber:

- **Uma medição que falhou nunca resolve uma regra.** "Não consegui medir" não é
  "parou".
- **Uma condição guardada que não parseia mais estoura** em vez de ser avaliada
  por palpite.
- Toda mudança de estado é gravada **no mesmo comando** que move a regra, então
  uma execução que morre entre as duas coisas não existe, e um replay é
  inofensivo.

## Canais

E-mail, Discord e um webhook seu. O aviso leva o nome da regra, o ambiente, o
valor medido e o limite, e um link para o Explorer com a busca e o período já
preenchidos, no idioma de quem recebe.

### Conferindo um webhook

Toda requisição de webhook leva o `X-NekoLog-Signature`: `sha256=` seguido do
HMAC-SHA256 do **corpo cru** com o segredo do canal, que são 32 bytes gerados
pelo servidor.

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function veioDoNekolog(corpoCru, header, segredo) {
  const esperado = `sha256=${createHmac('sha256', segredo).update(corpoCru).digest('hex')}`
  return header
    .split(',')
    .map((um) => um.trim())
    .some((um) => {
      const a = Buffer.from(um)
      const b = Buffer.from(esperado)
      return a.length === b.length && timingSafeEqual(a, b)
    })
}
```

Calcule sobre os bytes que você recebeu, não sobre um objeto reserializado.

**Durante uma rotação de segredo o header leva duas assinaturas**, separadas por
vírgula, **a atual primeiro** — a forma que o GitHub e a Stripe usam, para quem
confere qualquer uma das duas continuar funcionando. Ele nunca leva três: uma
janela que acumula é uma janela que ninguém fecha.

### Para onde um webhook pode apontar

O endereço é conferido quando o canal é salvo **e de novo na hora de enviar**,
porque uma linha pode ser mais velha que a proteção. Ele precisa ser `https` na
porta 443, e estes são recusados:

- credenciais na URL;
- `localhost`, `*.local`, `*.internal`, `*.lan`, `*.home.arpa`, `*.in-addr.arpa`;
- os hosts de metadata das nuvens;
- um nome sem ponto nenhum, que só existe dentro desta rede;
- toda faixa IPv4 e IPv6 privada ou reservada.

A requisição sai com `redirect: 'manual'` — um endereço público respondendo
`302` para um privado é o desvio clássico — e desiste depois de cinco segundos.

## O que nunca é enviado

O aviso nomeia a regra e o ambiente e linka para o Explorer. Ele **não** carrega
conteúdo de log. Um segredo guardado num canal é cifrado em repouso com o id do
canal como dado adicional autenticado, então um segredo copiado para outra linha
não abre.
