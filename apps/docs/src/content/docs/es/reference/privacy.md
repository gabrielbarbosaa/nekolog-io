---
title: Qué se guarda
description: Qué lleva una línea de log, qué se quita antes de salir de tu proceso, qué se quita en el servidor, y qué no se escribe nunca.
---

Los logs son lo más sensible que guarda esta plataforma, porque la gente mete
cosas ahí sin querer. Esta página es lo que el código hace al respecto — el
texto legal está en [/legal/privacy](https://nekolog.io/legal/privacy).

## La dirección IP no se escribe nunca

Ni con hash, ni truncada, ni un ratito. La fila se construye solo con el
**país**, leído de `CF-IPCountry` y validado como dos caracteres. No se consulta
ninguna cabecera de IP en ningún punto del camino, y hay un test que envía
`CF-Connecting-IP` y `X-Forwarded-For` y falla si la fila guardada contiene
cualquiera de las dos direcciones.

## Quitado antes de salir de tu proceso

El SDK quita dato sensible **dentro de tu aplicación**, así que nunca llega a la
red:

- **por clave**: `password`, `token`, `authorization`, `secret`, `cpf`, campos de
  tarjeta y más, a cualquier profundidad;
- **por valor en el texto**: un par `clave=valor` cuya clave es sensible, un
  número de tarjeta que pasa el test de Luhn, un CPF con dígito verificador
  válido, un JWT, credenciales `Bearer` y `Basic`, credenciales dentro de una
  URL, y una key de NekoLog.

Esto corre **después** de tu hook `beforeSend`, así que un hook no lo deshace.

Dos cosas más por defecto: `page.url` descarta la query string y el fragmento,
porque los tokens de restablecimiento y los códigos de invitación viven ahí; y
un breadcrumb de clic registra `button#pay` — el selector — y **nunca** el texto
ni el valor del elemento, porque una etiqueta puede nombrar a una persona.

## Quitado otra vez en el servidor

Cada entorno puede activar patrones con nombre, aplicados en la ingesta **antes
de escribir la fila**: correo, IPv4, IPv6, teléfono brasileño, CPF, CNPJ, JWT,
`Bearer`, UUID y tarjeta de crédito. Los atributos se pueden vaciar por clave
exacta o por prefijo.

**No** puedes aportar una expresión regular. La columna toma nombres de una
lista cerrada, y una check constraint rechaza una etiqueta llamada `regex`,
`pattern` o `patternSource`. Eso no es burocracia: la regex de un tercero en el
camino caliente de un Worker con 10 ms de CPU es una denegación de servicio que
te escribes tú mismo.

Si la regla guardada no se puede leer, la ingesta **aplica todos los patrones**
en vez de ninguno. Un control de privacidad que en silencio deja de funcionar es
peor que uno que redacta de más.

## Cuánto tiempo se queda

La retención es por entorno, y la impone el reloj del **servidor**, no el tuyo.
El `timestamp` guardado se acota a
`[received_at − (retención − 1h), received_at + 5min]`, y la distancia real va a
`clock_skew_ms`, así que la hora que enviaste siempre es
`received_at − clock_skew_ms`.

Ese acotado existe porque la tabla particiona y expira por esa columna. Un reloj
puesto en 2099 escribiría en una partición que ninguna consulta por periodo
alcanza y cuyo vencimiento solo llega en 2099; un reloj atrasado más allá de la
retención hace que la fila **desaparezca en el insert**, sin avisar a nadie. Los
cinco minutos de holgura hacia delante dejan en paz la deriva normal de NTP.

## Lo que puedes elegir no enviar

| | |
|---|---|
| Nivel mínimo | por entorno, impuesto en la ingesta |
| Muestreo | por entorno, una tasa entre 0 y 1 |

El muestreo se siembra en el id de traza, luego en el de sesión, así que **una
traza entera se conserva o se descarta junta** — media traza no le sirve a nadie
investigando. **`error` y `fatal` nunca se descartan por muestreo**, sea cual sea
la tasa: una tasa baja para controlar volumen debe cortar el ruido, no la señal.

Una configuración que no tiene sentido — un nivel desconocido, una tasa de cero
o por encima de uno — vuelve a dejar pasar todo, en vez de descartar tus logs en
silencio.

## Dónde está cada cosa

| | |
|---|---|
| Líneas de log | ClickHouse |
| Proyectos, keys, issues, alertas | Postgres, y solo el hash SHA-256 de la key, nunca la key |
| Source maps y exportaciones | un almacén de objetos |

Un enlace de exportación lleva al dashboard, nunca al archivo, y el bucket lo
borra a los siete días. Un source map nunca se sirve de vuelta por la API
pública: no existe ruta que lea uno.
