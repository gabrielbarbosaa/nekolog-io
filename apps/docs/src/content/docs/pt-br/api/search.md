---
title: Linguagem de busca
description: A linguagem que o Explorer e a API pública dividem, com os campos, os operadores e os limites dela.
---

Uma linguagem só, usada pelo Explorer no dashboard, pelo `q` em
[`/v1/logs` e `/v1/histogram`](/docs/pt-br/api/reference/) e pela condição de uma
[regra de alerta](/docs/pt-br/guides/alerts/).

```
timeout                              uma palavra na mensagem
"payment failed"                     uma frase exata na mensagem
level:error service:api              campos; espaço quer dizer E
level:(error OR fatal)               vários valores
service:api-*                        prefixo
-level:debug                         negação
@orderId:123                         um atributo
@status>=500                         comparação numérica num atributo
(service:api OR service:web) -level:debug
```

## Campos

`level`, `service`, `release`, `source`, `env`, `trace`, `span`, `session`,
`user`, `issue`, e qualquer atributo com `@`.

Qualquer outra coisa vira um erro que diz **em que ponto do texto** ele
desistiu, para uma busca longa dizer qual pedaço está errado em vez de falhar
inteira.

:::note[`env:` na API pública]
Uma key secreta já nomeia exatamente um ambiente, então `env:` ali é recusado
com `400` em vez de casar nada em silêncio. No dashboard, onde uma sessão pode
ver vários ambientes, ele funciona e toma o **nome** do ambiente.
:::

## Operadores

| | |
|---|---|
| Espaço, ou `AND` | os dois |
| `OR` | qualquer um |
| `-` ou `NOT` | isto não |
| `( … )` | agrupamento, até 5 níveis |
| `*` no fim de um valor | prefixo |
| `>`, `>=`, `<`, `<=` | numérico, só em `@atributos` |

Uma palavra solta casa uma **palavra inteira** na mensagem, sem diferenciar
maiúsculas. Uma `"frase"` entre aspas casa aquele texto em qualquer lugar da
mensagem, o que é mais lento mas acha `api.timeout` — um `timeout` solto não
acha, porque busca por palavra para nos separadores.

## Limites

| | |
|---|---|
| Tamanho | 1000 caracteres |
| Condições | 20 |
| Aninhamento | 5 níveis de parênteses |

Eles existem para uma consulta não custar o ClickHouse de todo mundo. Uma busca
acima de qualquer um deles é recusada antes de rodar, não morta no meio.

## O que acontece com o seu texto

Ele vira uma árvore sintática e depois **SQL com parâmetros, sempre**. Nada que
você digita é colado dentro de um comando — inclusive o **nome** de um atributo:
`@orderId` vira `attributes[{p1:String}]`, nunca `attributes['orderId']`. Esse é
o único lugar onde interpolar seria injeção, já que `@a'] OR 1=1 --:x` fecha o
colchete, e ele é parâmetro como todo o resto.

O projeto, o ambiente e o período são postos pelo servidor, depois do seu filtro
e em volta dele. Não existe busca que você escreva que os alargue.

O parser passa por [fuzzing](https://fast-check.dev/) e a API compilada é
varrida com o OWASP ZAP; as regras de SQL injection dele passam.
