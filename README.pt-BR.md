# NekoLog

> Plataforma de logs para aplicações JavaScript/TypeScript, no front-end e no back-end.
>
> Leia em [English (en)](README.md) ou [Español (es)](README.es.md).

O NekoLog é uma plataforma de logs open-core: SDKs publicados no npm que enviam logs em lote, uma API de ingestão, armazenamento analítico (ClickHouse), jobs de alertas e um dashboard com busca, filtros, gráficos, issues e alertas — com keys de API separadas por ambiente.

Este repositório (SDKs, ingestão, jobs, API pública de leitura, site e docs) é open source sob MIT e pode ser hospedado por conta própria com Docker. O dashboard em si é de código fechado, vive num repositório privado complementar e só roda na instância hospedada na nuvem — veja a seção 1 do [docs/PLANO.md](docs/PLANO.md) pra entender o porquê.

É um projeto pessoal de estudo que roda inteiramente em serviços gratuitos na nuvem.

## Status

🚧 **Em desenvolvimento inicial.** O projeto está na etapa de planejamento — veja [docs/ETAPAS.md](docs/ETAPAS.md) para o passo a passo e o progresso.

## Documentação

- [docs/PLANO.md](docs/PLANO.md) — plano do projeto: arquitetura, modelo de dados, APIs, autenticação, tema, idiomas, segurança e operação.
- [docs/ETAPAS.md](docs/ETAPAS.md) — roteiro de implementação, etapa por etapa.
- [docs/ESPECIFICACOES.md](docs/ESPECIFICACOES.md) — especificações técnicas (payload de ingestão, variáveis de ambiente, linguagem de busca, fingerprint de erros, regras de alerta).

## Licença

[MIT](LICENSE)
