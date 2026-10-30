# ADR 0004 — ClickHouse numa VM Oracle Always Free

- **Status:** aceita
- **Data:** 2026-10-29
- **Plano:** seções 1, 4, 7 e 22

## Contexto

Logs são o dado de maior volume da plataforma e o padrão de uso é analítico:
filtrar por projeto, ambiente e janela de tempo, contar por nível e serviço,
agrupar por minuto para os gráficos. Um banco relacional linha-a-linha faz isso
mal em escala.

A restrição de custo (ADR [0003](0003-so-servicos-gratuitos.md)) elimina
serviços gerenciados: o ClickHouse Cloud só tem trial, sem plano gratuito
permanente.

## Decisão

ClickHouse rodando em Docker numa VM Oracle Cloud **Always Free** (ARM, 2 OCPU
e 12 GB de RAM depois do corte de cota de 2026).

A VM é tratada como **descartável**: recriada por script (cloud-init +
docker-compose), sem estado que não possa ser perdido. Usuários, organizações e
keys ficam no Neon Postgres; logs são, por definição, descartáveis.

Acesso só pelo Cloudflare Tunnel, sem nenhuma porta de entrada aberta.

Metadados (usuários, projetos, keys, regras de alerta) ficam no **Neon
Postgres** — gratuito, gerenciado e com backup, e um volume que cabe folgado em
0,5 GB.

## Consequências

- **Operação de banco vira responsabilidade do projeto.** Atualização, disco,
  backup e monitoramento são manuais, ao contrário de um serviço gerenciado. Daí
  os alertas de disco acima de 80% e o monitor externo.
- **A ingestão não pode depender do Postgres.** O Neon hiberna depois de 5
  minutos parado; consultar a key no caminho quente adicionaria o cold start a
  cada request. É por isso que as keys são copiadas para o Workers KV.
- **Retenção via TTL por linha.** Cada log carrega `retention_days`, vindo da
  configuração do ambiente, e o `TTL` da tabela usa essa coluna. Não existe job
  de limpeza, e mudar a retenção vale só para logs novos.
- **Dois usuários no ClickHouse**, um só com `INSERT` (ingestão) e outro só com
  `SELECT` (dashboard e jobs). Um vazamento de credencial da ingestão não lê
  dados de ninguém.
- **A Oracle pode recuperar a VM.** Contas Always Free ociosas podem ser
  reclamadas, e a cota já foi cortada uma vez. Por isso a VM é recriável por
  script e o `LogStore` é uma interface — o Tinybird Free é o plano B, trocável
  sem reescrever a aplicação.
- **ARM limita imagens.** Tudo que roda na VM precisa ter build `arm64`.

## Alternativas consideradas

- **ClickHouse Cloud.** A opção natural, sem operação. Descartada: só trial, sem
  plano gratuito permanente (confirmado em 2026).
- **Tinybird Free (10 GB, 1.000 consultas/dia).** É ClickHouse gerenciado e
  entraria sem operação nenhuma. Ficou como **plano B** em vez de escolha
  principal porque o limite de 1.000 consultas/dia é apertado para um dashboard
  que faz polling de 2–3 s no tempo real, e porque operar o ClickHouse é parte
  do que se quer estudar.
- **Postgres (o mesmo do Neon) para os logs também.** Uma peça a menos.
  Descartada: 0,5 GB de cota e desempenho analítico ruim em agregações sobre
  milhões de linhas — exatamente o caso de uso principal.
- **Timescale, DuckDB, SQLite.** Descartadas por cota gratuita, modelo de
  concorrência ou falta de um caminho de escala para ingestão contínua.
