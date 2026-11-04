---
title: Rodar o NekoLog por conta própria
description: Um comando sobe ingestão, jobs, ClickHouse e Postgres na sua própria máquina.
---

:::caution[O dashboard não faz parte disto]
O NekoLog é open-core. Os SDKs, a ingestão, os jobs e esta documentação são MIT
e vivem no repositório público; **o dashboard é fechado e só roda no serviço
hospedado**. Rodar por conta própria dá ingestão, armazenamento, agrupamento de
erros e alertas — não uma tela para olhar para eles. Leia a seção *O que você
não ganha* antes de começar, não depois.
:::

## O que você precisa

Uma máquina com Docker e o plugin Compose, 4 GB de RAM e um disco que você
aceite encher de log. Nada além disso: sem conta na Cloudflare, sem Postgres
gerenciado, sem armazenamento de objetos.

```bash
git clone https://github.com/gabrielbarbosaa/nekolog-io
cd nekolog-io/deploy/self-host
./up.sh
```

O `up.sh` escreve um `.env` com segredos gerados na hora se ainda não existir
um, constrói a imagem e sobe o stack. É um comando só porque a alternativa —
uma lista de passos em que um é pulado — é exatamente como um self-host termina
com uma senha em branco em produção.

A primeira execução diz onde as suas keys foram escritas. Elas **não** aparecem
no log do container, de propósito:

```bash
docker compose run --rm --entrypoint sh bootstrap -c 'cat /var/lib/nekolog/state/first-run-keys.txt'
docker compose run --rm --entrypoint sh bootstrap -c 'rm /var/lib/nekolog/state/first-run-keys.txt'
```

Copie para um lugar seguro e apague o arquivo. Elas aparecem uma única vez.

## Mande o primeiro log

A ingestão responde na porta 8787. Aponte qualquer SDK do NekoLog para ela:

```bash
NEKOLOG_KEY=nekolog_sk_…
NEKOLOG_ENDPOINT=http://localhost:8787
```

```ts
import { createLogger } from '@nekolog-io/node'

const log = createLogger({ key: process.env.NEKOLOG_KEY, endpoint: process.env.NEKOLOG_ENDPOINT })
log.error('quebrou', new Error('cannot read properties of undefined'))
```

:::danger[Ponha TLS na frente]
O container de ingestão fala HTTP puro, e uma API key viaja no cabeçalho
`Authorization`. Expor a porta 8787 na internet publica as suas keys para quem
estiver no caminho. Ponha Caddy, nginx ou qualquer proxy reverso com
certificado na frente antes de apontar um serviço de produção para lá.
:::

## O que está rodando

| Container | O que faz |
|---|---|
| `ingest` | valida, remove dado sensível, calcula o fingerprint e grava cada lote |
| `jobs` | acorda a cada minuto: alertas, agrupamento, cotas, spool, capacidade |
| `clickhouse` | os logs |
| `postgres` | projetos, ambientes, keys, issues, regras e canais de alerta |
| `bootstrap` | roda uma vez: migrações, depois o primeiro projeto e as keys |

Nenhum dos dois bancos publica porta. Eles só são alcançáveis de dentro da rede
do compose, que é o que impede uma senha padrão numa máquina na nuvem de virar
um vazamento.

## O que você não ganha

Três coisas faltam, e nenhuma delas é um defeito para contornar:

- **O dashboard.** Ele é fechado e só existe no serviço hospedado.
- **Exportações.** A etapa 4.12 gera o CSV pelo próprio ClickHouse dentro de um
  bucket S3. Isso precisa de armazenamento de objetos e de credenciais que este
  stack não pede, então as tarefas de exportação simplesmente não estão ligadas
  no container de jobs — em vez de ligadas e falhando a cada minuto.
- **Resolução de source map.** Precisa de um lugar para subir os mapas, que
  ainda está sendo desenhado.

Todo o resto roda: ingestão, OTLP, remoção de dado sensível, amostragem, nível
mínimo, cotas, agrupamento de erros e alertas para um webhook.

## Keys, ambientes e retenção

A primeira execução cria um projeto com um ambiente chamado `production`,
guardado por 30 dias. Mude isso antes da primeira execução:

```bash
SEED_ENVIRONMENTS=production,staging SEED_RETENTION_DAYS=14 ./up.sh
```

Depois, gere outra key sem mexer nas que já estão em uso:

```bash
docker compose run --rm --entrypoint sh bootstrap -c \
  'pnpm seed add-key --environment production --file /var/lib/nekolog/state/.nekolog-seed.json'
```

Uma key aparece uma vez e só o hash dela é guardado, aqui como no serviço
hospedado. O `seed init` se recusa a sobrescrever um projeto que já existe:
identificadores novos deixariam órfã cada linha que já está no ClickHouse.

## Alertas

Uma regra de alerta mora no Postgres e o container de jobs a avalia a cada
minuto. Sem o dashboard você escreve as linhas na mão, que é também como você
faria isso por script:

```bash
docker compose exec postgres psql -U nekolog -d nekolog
```

A mensagem do alerta carrega o ambiente, o valor medido, o limite e a janela,
mais um link construído a partir de `NEKOLOG_CONSOLE_URL`. O self-host não traz
tela nenhuma, então aponte essa variável para o que você realmente usa para ler
log — ela só vira um link dentro da mensagem, nada chama esse endereço.

Defina `OPS_DISCORD_WEBHOOK_URL` para saber da plataforma em si: um disco
enchendo, um spool que não drena, um ambiente bloqueado por estourar a cota.

## Backups

Dois volumes guardam dado que você não consegue gerar de novo, e um guarda um
segredo:

- `nekolog_clickhouse_data` — os logs.
- `nekolog_postgres_data` — projetos, keys, issues, regras de alerta.
- `.env` — o `ENCRYPTION_KEY` sela o segredo de cada canal de alerta. Ele não
  está em banco nenhum e não dá para recuperá-lo de nenhum. Guarde-o separado
  dos bancos e, se um dia trocá-lo, re-encripte antes de reiniciar.

## Atualizar

```bash
git pull
docker compose up -d --build
```

O container de bootstrap roda de novo e aplica qualquer migração nova antes de
os outros dois subirem. As migrações são só para a frente: não existe passo de
volta, que é por que um backup antes de atualizar vale o minuto que custa.

## Quando não sobe

O stack se recusa a rodar meio configurado em vez de subir com algo adivinhável,
então a falha diz o que está faltando.

| O que aparece | O que quer dizer |
|---|---|
| `set CLICKHOUSE_… in .env` | o compose não tem `.env`; rode `./up.sh` ou copie `.env.example` |
| `is missing SPOOL_DIR, KV_DIR` | o container perdeu os volumes |
| `Nothing answered on ClickHouse` | o ClickHouse ainda está subindo; ele espera o healthcheck |
| `Not enough privileges` | o `clickhouse-users.xml` foi editado; reinicie o container do clickhouse |

O `docker compose logs jobs` imprime uma linha JSON por minuto nomeando cada
tarefa que rodou e quanto demorou. Essa linha é o jeito mais rápido de ver se a
plataforma está funcionando.
