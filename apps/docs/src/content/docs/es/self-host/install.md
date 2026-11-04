---
title: Ejecutar NekoLog por tu cuenta
description: Un comando levanta la ingesta, los jobs, ClickHouse y Postgres en tu propia máquina.
---

:::caution[El panel no forma parte de esto]
NekoLog es open-core. Los SDK, la ingesta, los jobs y esta documentación son MIT
y viven en el repositorio público; **el panel es cerrado y solo corre en el
servicio alojado**. Ejecutarlo por tu cuenta te da ingesta, almacenamiento,
agrupación de errores y alertas — no una pantalla para mirarlos. Lee la sección
*Lo que no obtienes* antes de empezar, no después.
:::

## Lo que necesitas

Una máquina con Docker y el plugin Compose, 4 GB de RAM y un disco que estés
dispuesto a llenar de registros. Nada más: sin cuenta de Cloudflare, sin
Postgres gestionado, sin almacenamiento de objetos.

```bash
git clone https://github.com/gabrielbarbosaa/nekolog-io
cd nekolog-io/deploy/self-host
./up.sh
```

`up.sh` escribe un `.env` con secretos recién generados si todavía no hay uno,
construye la imagen y levanta el stack. Es un solo comando porque la
alternativa — una lista de pasos donde uno se salta — es justo como un
self-host termina con una contraseña en blanco en producción.

La primera ejecución dice dónde quedaron tus claves. **No** están en el registro
del contenedor, a propósito:

```bash
docker compose run --rm --entrypoint sh bootstrap -c 'cat /var/lib/nekolog/state/first-run-keys.txt'
docker compose run --rm --entrypoint sh bootstrap -c 'rm /var/lib/nekolog/state/first-run-keys.txt'
```

Cópialas a un lugar seguro y borra el archivo. Aparecen una sola vez.

## Envía el primer registro

La ingesta responde en el puerto 8787. Apunta cualquier SDK de NekoLog hacia
ella:

```bash
NEKOLOG_KEY=nekolog_sk_…
NEKOLOG_ENDPOINT=http://localhost:8787
```

```ts
import { createLogger } from '@nekolog-io/node'

const log = createLogger({ key: process.env.NEKOLOG_KEY, endpoint: process.env.NEKOLOG_ENDPOINT })
log.error('se rompió', new Error('cannot read properties of undefined'))
```

:::danger[Pon TLS delante]
El contenedor de ingesta habla HTTP plano, y una clave de API viaja en la
cabecera `Authorization`. Exponer el puerto 8787 a internet publica tus claves a
quien esté en el camino. Pon Caddy, nginx o cualquier proxy inverso con
certificado delante antes de apuntar un servicio de producción ahí.
:::

## Lo que está corriendo

| Contenedor | Qué hace |
|---|---|
| `ingest` | valida, redacta, calcula la huella y escribe cada lote |
| `jobs` | despierta cada minuto: alertas, agrupación, cuotas, spool, capacidad |
| `clickhouse` | los registros |
| `postgres` | proyectos, entornos, claves, incidencias, reglas y canales de alerta |
| `bootstrap` | corre una vez: migraciones, luego el primer proyecto y sus claves |

Ninguna de las dos bases publica un puerto. Solo se alcanzan desde dentro de la
red del compose, que es lo que impide que una contraseña por defecto en una
máquina en la nube se convierta en una filtración.

## Lo que no obtienes

Faltan tres cosas, y ninguna es un defecto que debas sortear:

- **El panel.** Es cerrado y solo existe en el servicio alojado.
- **Las exportaciones.** El paso 4.12 genera el CSV desde el propio ClickHouse
  dentro de un bucket S3. Eso necesita almacenamiento de objetos y credenciales
  que este stack no te pide, así que las tareas de exportación directamente no
  están conectadas en el contenedor de jobs — en vez de conectadas y fallando
  cada minuto.
- **La resolución de source maps.** Necesita un lugar donde subir los mapas, que
  todavía se está diseñando.

Todo lo demás corre: ingesta, OTLP, redacción, muestreo, nivel mínimo, cuotas,
agrupación de errores y alertas hacia un webhook.

## Claves, entornos y retención

La primera ejecución crea un proyecto con un entorno llamado `production`,
guardado 30 días. Cámbialo antes de la primera ejecución:

```bash
SEED_ENVIRONMENTS=production,staging SEED_RETENTION_DAYS=14 ./up.sh
```

Después, genera otra clave sin tocar las que ya están en uso:

```bash
docker compose run --rm --entrypoint sh bootstrap -c \
  'pnpm seed add-key --environment production --file /var/lib/nekolog/state/.nekolog-seed.json'
```

Una clave aparece una vez y solo se guarda su hash, aquí igual que en el
servicio alojado. `seed init` se niega a sobrescribir un proyecto existente:
identificadores nuevos dejarían huérfana cada fila que ya está en ClickHouse.

## Alertas

Una regla de alerta vive en Postgres y el contenedor de jobs la evalúa cada
minuto. Sin el panel escribes las filas a mano, que es también como las
escribirías desde un script:

```bash
docker compose exec postgres psql -U nekolog -d nekolog
```

El mensaje de la alerta lleva el entorno, el valor medido, el umbral y la
ventana, más un enlace construido a partir de `NEKOLOG_CONSOLE_URL`. El
self-host no trae pantalla, así que apunta esa variable a lo que de verdad uses
para leer registros — solo se convierte en un enlace dentro del mensaje, nada
llama a esa dirección.

Define `OPS_DISCORD_WEBHOOK_URL` para enterarte de la plataforma en sí: un disco
llenándose, un spool que no drena, un entorno bloqueado por pasarse de cuota.

## Copias de seguridad

Dos volúmenes guardan datos que no puedes volver a generar, y uno guarda un
secreto:

- `nekolog_clickhouse_data` — los registros.
- `nekolog_postgres_data` — proyectos, claves, incidencias, reglas de alerta.
- `.env` — `ENCRYPTION_KEY` sella el secreto de cada canal de alerta. No está en
  ninguna base y no se puede recuperar de ninguna. Guárdalo aparte de las bases
  y, si alguna vez lo cambias, vuelve a cifrar antes de reiniciar.

## Actualizar

```bash
git pull
docker compose up -d --build
```

El contenedor de bootstrap corre de nuevo y aplica cualquier migración nueva
antes de que los otros dos arranquen. Las migraciones son solo hacia adelante:
no hay paso de vuelta, por eso una copia antes de actualizar vale el minuto que
cuesta.

## Cuando no arranca

El stack se niega a correr a medio configurar en vez de arrancar con algo
adivinable, así que el fallo nombra lo que falta.

| Lo que ves | Lo que significa |
|---|---|
| `set CLICKHOUSE_… in .env` | el compose no tiene `.env`; corre `./up.sh` o copia `.env.example` |
| `is missing SPOOL_DIR, KV_DIR` | el contenedor perdió sus volúmenes |
| `Nothing answered on ClickHouse` | ClickHouse todavía arranca; espera al healthcheck |
| `Not enough privileges` | se editó `clickhouse-users.xml`; reinicia el contenedor de clickhouse |

`docker compose logs jobs` imprime una línea JSON por minuto nombrando cada
tarea que corrió y cuánto tardó. Esa línea es la forma más rápida de ver si la
plataforma está funcionando.
