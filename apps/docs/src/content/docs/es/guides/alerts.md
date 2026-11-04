---
title: Alertas
description: Reglas evaluadas cada minuto, y los canales a los que llegan — incluido cómo verificar que un webhook vino de verdad de NekoLog.
---

:::caution[Todavía no está en npm]
Los paquetes `@nekolog-io/*` aún no se han publicado, y todavía no hay instancia
alojada. Esta página describe el comportamiento que el código ya tiene, para que
la forma de la API quede clara.
:::

Una regla es una [búsqueda](/docs/es/api/search/), una ventana y un umbral. Cada
minuto un job mide cada regla de cada entorno y, cuando la respuesta cruza,
envía un aviso a los canales que la regla nombra. Las creas en el dashboard; lo
que sigue es lo que corre.

## Los cinco tipos

| Tipo | Dispara cuando |
|---|---|
| `threshold` | el conteo de logs que casan la búsqueda, en la ventana, pasa el valor |
| `error_rate` | la proporción de `error` y `fatal` en la ventana pasa el valor, por encima de un piso `minEvents`, para que un servicio tranquilo no alerte por una línea |
| `new_issue` | aparece una issue en el entorno por primera vez |
| `issue_regression` | una issue que estaba resuelta vuelve a ocurrir |
| `absence` | **nada** que case la búsqueda llegó durante la ventana — un servicio que dejó de reportar |

Las ventanas son `1m`, `5m`, `15m` o `1h`.

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

La condición **no lleva entorno**. El entorno es una columna de la regla, y es
la mitad de la clave foránea que impide que una regla de un proyecto apunte al
entorno de otro. Una segunda copia dentro del JSON sería una segunda verdad que
ninguna constraint alcanza, así que se rechaza.

## Disparar, y parar

Una regla guarda dos estados, `ok` y `firing`. "Resuelta" es la vuelta a `ok`, y
también envía un aviso — que te digan que algo se rompió y nunca que se arregló
es peor que un mensaje de más.

El `cooldown` retiene la **repetición del aviso de disparo**, contada desde el
último aviso de disparo que realmente salió. Nunca retiene el de "ya pasó". Un
aviso retenido igual queda registrado, marcado como suprimido, para que una
pantalla pueda decir por qué no se avisó a nadie.

Tres rechazos que conviene saber:

- **Una medición que falló nunca resuelve una regla.** "No pude medir" no es
  "se detuvo".
- **Una condición guardada que ya no parsea lanza** en vez de evaluarse a ojo.
- Cada cambio de estado se escribe **en la misma sentencia** que mueve la regla,
  así que una ejecución que muere entre las dos cosas no puede existir, y un
  replay es inofensivo.

## Canales

Correo, Discord y un webhook tuyo. El aviso lleva el nombre de la regla, el
entorno, el valor medido y el umbral, y un enlace al Explorer con la búsqueda y
el periodo ya puestos, en el idioma de quien lo recibe.

### Verificar un webhook

Cada petición de webhook lleva `X-NekoLog-Signature`: `sha256=` seguido del
HMAC-SHA256 del **cuerpo crudo** con el secreto del canal, que son 32 bytes que
generó el servidor.

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function vinoDeNekolog(cuerpoCrudo, cabecera, secreto) {
  const esperado = `sha256=${createHmac('sha256', secreto).update(cuerpoCrudo).digest('hex')}`
  return cabecera
    .split(',')
    .map((uno) => uno.trim())
    .some((uno) => {
      const a = Buffer.from(uno)
      const b = Buffer.from(esperado)
      return a.length === b.length && timingSafeEqual(a, b)
    })
}
```

Calcúlalo sobre los bytes que recibiste, no sobre un objeto reserializado.

**Durante una rotación de secreto la cabecera lleva dos firmas**, separadas por
coma, **la actual primero** — la forma que usan GitHub y Stripe, para que quien
comprueba cualquiera de las dos siga funcionando. Nunca lleva tres: una ventana
que se acumula es una ventana que nadie cierra.

### A dónde puede apuntar un webhook

La dirección se comprueba cuando se guarda el canal **y otra vez al enviar**,
porque una fila puede ser más vieja que la protección. Tiene que ser `https` en
el puerto 443, y se rechazan:

- credenciales en la URL;
- `localhost`, `*.local`, `*.internal`, `*.lan`, `*.home.arpa`, `*.in-addr.arpa`;
- los hosts de metadatos de las nubes;
- un nombre sin ningún punto, que solo puede existir dentro de esta red;
- todo rango IPv4 e IPv6 privado o reservado.

La petición sale con `redirect: 'manual'` — una dirección pública respondiendo
`302` hacia una privada es el bypass clásico — y se rinde a los cinco segundos.

## Lo que nunca se envía

El aviso nombra la regla y el entorno y enlaza al Explorer. **No** lleva
contenido de log. Un secreto guardado en un canal se cifra en reposo con el id
del canal como dato adicional autenticado, así que un secreto copiado a otra
fila no abre.
