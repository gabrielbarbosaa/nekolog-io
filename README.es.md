# NekoLog

> Plataforma de logs para aplicaciones JavaScript/TypeScript, en el front-end y en el back-end.
>
> Léelo en [English (en)](README.md) o [Português (pt-BR)](README.pt-BR.md).

NekoLog es una plataforma de logs open-core: SDKs publicados en npm que envían logs por lotes, una API de ingestión, almacenamiento analítico (ClickHouse), jobs de alertas y un dashboard con búsqueda, filtros, gráficos, issues y alertas — con claves de API separadas por entorno.

Este repositorio (SDKs, ingestión, jobs, API pública de lectura, sitio y docs) es open source bajo MIT y puede alojarse por cuenta propia con Docker. El dashboard en sí es de código cerrado, vive en un repositorio privado complementario y solo funciona en la instancia alojada en la nube — consulta la sección 1 de [docs/PLANO.md](docs/PLANO.md) para entender por qué.

Es un proyecto personal de estudio que funciona enteramente con servicios gratuitos en la nube.

## Estado

🚧 **En desarrollo inicial.** El proyecto está en etapa de planificación — consulta [docs/ETAPAS.md](docs/ETAPAS.md) para ver la hoja de ruta y el progreso.

## Documentación

- [docs/PLANO.md](docs/PLANO.md) — plan del proyecto: arquitectura, modelo de datos, APIs, autenticación, tema, idiomas, seguridad y operación.
- [docs/ETAPAS.md](docs/ETAPAS.md) — hoja de ruta de implementación, paso a paso.
- [docs/ESPECIFICACOES.md](docs/ESPECIFICACOES.md) — especificaciones técnicas (payload de ingestión, variables de entorno, lenguaje de búsqueda, fingerprint de errores, reglas de alerta).

## Licencia

[MIT](LICENSE)
