# NekoLog

> Logging platform for JavaScript/TypeScript applications, front-end and back-end.
>
> Read this in [Português (pt-BR)](README.pt-BR.md) or [Español (es)](README.es.md).

NekoLog is an open-core logging platform: npm SDKs that batch-send logs from your app, an ingestion API, analytical storage (ClickHouse), background jobs for alerts, and a dashboard with search, filters, charts, issues, and alerts — with separate API keys per environment.

This repository (SDKs, ingestion, jobs, public read API, site, and docs) is open source under MIT and can be self-hosted with Docker. The dashboard itself is closed-source, lives in a private companion repository, and only runs on the hosted cloud instance — see [docs/PLANO.md](docs/PLANO.md) section 1 for why.

It's a personal study project that runs entirely on free-tier cloud services.

## Status

🚧 **Early development.** The project is currently in its planning stage — see [docs/ETAPAS.md](docs/ETAPAS.md) for the step-by-step roadmap and progress.

## Documentation

- [docs/PLANO.md](docs/PLANO.md) — project plan: architecture, data model, APIs, authentication, theming, i18n, security, and operations.
- [docs/ETAPAS.md](docs/ETAPAS.md) — implementation roadmap, one step at a time.
- [docs/ESPECIFICACOES.md](docs/ESPECIFICACOES.md) — technical specifications (ingestion payload, environment variables, search language, error fingerprinting, alert rules).

## License

[MIT](LICENSE)
