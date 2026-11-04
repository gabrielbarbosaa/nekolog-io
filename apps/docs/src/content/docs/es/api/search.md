---
title: Lenguaje de búsqueda
description: El lenguaje que comparten el Explorer y la API pública, con sus campos, operadores y límites.
---

:::caution[Todavía no está en npm]
Los paquetes `@nekolog-io/*` aún no se han publicado, y todavía no hay instancia
alojada. Esta página describe el comportamiento que el código ya tiene, para que
la forma de la API quede clara.
:::

Un solo lenguaje, usado por el Explorer en el dashboard, por `q` en
[`/v1/logs` y `/v1/histogram`](/docs/es/api/reference/) y por la condición de una
[regla de alerta](/docs/es/guides/alerts/).

```
timeout                              una palabra en el mensaje
"payment failed"                     una frase exacta en el mensaje
level:error service:api              campos; un espacio significa Y
level:(error OR fatal)               varios valores
service:api-*                        prefijo
-level:debug                         negación
@orderId:123                         un atributo
@status>=500                         una comparación numérica sobre un atributo
(service:api OR service:web) -level:debug
```

## Campos

`level`, `service`, `release`, `source`, `env`, `trace`, `span`, `session`,
`user`, `issue`, y cualquier atributo con `@`.

Cualquier otra cosa es un error que dice **en qué punto del texto** se rindió,
para que una consulta larga diga qué parte está mal en vez de fallar entera.

:::note[`env:` en la API pública]
Una key secreta ya nombra exactamente un entorno, así que `env:` ahí se rechaza
con un `400` en vez de no casar nada en silencio. En el dashboard, donde una
sesión puede ver varios entornos, funciona y toma el **nombre** del entorno.
:::

## Operadores

| | |
|---|---|
| Espacio, o `AND` | ambos |
| `OR` | cualquiera |
| `-` o `NOT` | esto no |
| `( … )` | agrupación, hasta 5 niveles |
| `*` al final de un valor | prefijo |
| `>`, `>=`, `<`, `<=` | numérico, solo sobre `@atributos` |

Una palabra suelta casa una **palabra entera** en el mensaje, sin distinguir
mayúsculas. Una `"frase"` entre comillas casa ese texto en cualquier parte del
mensaje, lo que es más lento pero encuentra `api.timeout` — un `timeout` suelto
no lo encuentra, porque la búsqueda por palabra se detiene en los separadores.

## Límites

| | |
|---|---|
| Longitud | 1000 caracteres |
| Condiciones | 20 |
| Anidamiento | 5 niveles de paréntesis |

Están ahí para que una consulta no le cueste a todos los demás su ClickHouse.
Una búsqueda por encima de cualquiera de ellos se rechaza antes de correr, no se
mata a medias.

## Qué pasa con tu texto

Se convierte en un árbol sintáctico y después en **SQL con parámetros,
siempre**. Nada de lo que escribes se pega dentro de una sentencia — incluido el
**nombre** de un atributo: `@orderId` compila a `attributes[{p1:String}]`, nunca
`attributes['orderId']`. Ese es el único sitio donde interpolar sería una
inyección, ya que `@a'] OR 1=1 --:x` cierra el corchete, y es un parámetro como
todo lo demás.

El proyecto, el entorno y el periodo los pone el servidor, después de tu filtro y
alrededor de él. No hay búsqueda que puedas escribir que los ensanche.

El parser pasa por [fuzzing](https://fast-check.dev/) y la API compilada se
escanea con OWASP ZAP; sus reglas de inyección SQL pasan.
