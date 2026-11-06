# Benchmark — NekoLog contra Splunk, Datadog, Dynatrace e Sumo Logic

> Levantado em 04/11/2026, com a 1.0 fechada (`966f509`) e todas as etapas
> deste repositório marcadas. Compara o que os quatro produtos oferecem hoje
> com o que existe aqui, separa lacuna real de decisão de escopo, e propõe
> requisitos. **Nada aqui está decidido** — é material para decisão.

## Método e limites

As capacidades dos quatro vieram da documentação oficial de cada um
(`docs.datadoghq.com/logs`, `help.splunk.com/.../splunk-observability-cloud`,
`docs.dynatrace.com/.../logs`, `help.sumologic.com/docs`), com páginas de
produto como complemento. Três ressalvas que valem para a leitura inteira:

1. **Nada foi testado.** É leitura de documentação, não uso. Onde a fonte é
   marketing e não doc, está marcado.
2. **Alerta por log no Splunk Observability** aparece anunciado para setembro
   de 2026 e não consegui confirmar nas notas de versão que saiu. Tratado como
   existente, porque o Splunk Enterprise tem alerta por busca agendada desde
   sempre.
3. **Comparar porte não é o objetivo.** Os quatro são plataformas de
   observabilidade com empresa, agente, centenas de integrações e certificação.
   O NekoLog é uma plataforma de log para JS/TS, de um mantenedor, que cabe em
   plano gratuito. A pergunta útil não é "o que falta para empatar", é **"o que
   eles resolveram que nós também deveríamos resolver, dentro do que a gente se
   propôs a ser"**.

---

## 1. O que existe aqui hoje

Inventário honesto, para a comparação ter um lado concreto.

| Área | Estado |
|---|---|
| Coleta | 12 SDKs JS/TS (browser, node, react, next, express, fastify, hono, nestjs, pino, winston, cli, bundler-plugin) + `POST /v1/otlp/logs` (OTLP/HTTP, só logs) |
| Ingestão | Hono no Worker e em Node; validação Valibot, gzip, limites de lote, dedup por `<environmentId>:<batchId>`, contingência no R2 com reenvio pelos jobs |
| Processamento no ingest | Remoção de dado sensível (lista fechada de 10 padrões, por chave e por prefixo), fingerprint de erro (especificação 5), nível mínimo, amostragem semeada no trace, limite de `timestamp`, `clock_skew_ms`, país a partir do IP (o IP nunca é gravado) |
| Armazenamento | ClickHouse, `logs` + dois rollups (`logs_per_minute` por `timestamp`, `usage_per_minute` por `received_at`), TTL por retenção do ambiente |
| Busca | Gramática própria (especificação 4): 10 campos + atributos com `@`, palavra, frase, prefixo, `AND`/`OR`/`NOT`, parênteses, comparação numérica. Compila para `WHERE` parametrizado. **Só filtra** |
| Consulta pública | `GET /v1/logs`, `/v1/histogram`, `/v1/issues`, `/openapi.json`; `POST /v1/releases` e `/v1/sourcemaps` são as únicas escritas |
| Agrupamento de erro | Issues por fingerprint, com `first_seen`/`last_seen`, reabertura com `regressed_at`, estados aberta/resolvida/ignorada |
| Alertas | 5 tipos (`threshold`, `error_rate`, `new_issue`, `issue_regression`, `absence`), janelas de 1m/5m/15m/1h, canais e-mail/Slack/Discord/webhook assinado (HMAC com rotação de dois segredos), cooldown, histórico de 90 dias |
| Exportação | CSV (com guarda contra injeção de fórmula), JSON e XML, manual e agendada, gerada pelo próprio ClickHouse para o R2, aviso por e-mail com link autenticado, validade de 7 dias |
| Operação | Cotas diárias por ambiente, bloqueio por cota via KV, heartbeat, `capacity-watch`, alertas de operador no Discord, backup do Postgres criptografado com teste de restauração |
| Segurança | Modelo de ameaças v2, ASVS nível 2 documentado, ZAP nos dois serviços, SBOM CycloneDX por pacote, trusted publishing sem token |
| Interface | **Nenhuma.** O dashboard é fechado, está no outro repositório, e 7 telas continuam abertas lá |

E o que o próprio repositório já registra como não cumprido: o SDK de navegador
está em **12,05 kB** contra a meta de 5 kB, nada foi publicado no npm, nada foi
aplicado em infraestrutura, e as cinco tarefas manuais de conta e domínio
continuam pendentes.

---

## 2. O que os quatro têm

Consolidado por categoria. `✓` = documentado; `~` = parcial ou com ressalva.

### 2.1 Coleta

| | Splunk | Datadog | Dynatrace | Sumo |
|---|:-:|:-:|:-:|:-:|
| Agente instalado no host | ✓ forwarder | ✓ Agent | ✓ OneAgent | ✓ Collector |
| Arquivo, syslog, container, Kubernetes | ✓ | ✓ | ✓ | ✓ |
| Integrações de nuvem prontas | ✓ | ✓ (centenas) | ✓ hyperscalers | ✓ |
| OpenTelemetry | ✓ | ✓ | ✓ | ✓ |
| Consultar log onde ele já está, sem copiar | ✓ Log Observer Connect | ~ Federated Logs, CloudPrem | — | — |
| SDK de aplicação como caminho principal | — | — | — | — |

**Nós:** só SDK de aplicação e OTLP. Nenhum agente, nenhum arquivo, nenhum
syslog, nenhuma integração de nuvem.

### 2.2 Processamento na entrada

| | Splunk | Datadog | Dynatrace | Sumo |
|---|:-:|:-:|:-:|:-:|
| Pipelines de processamento configuráveis | ✓ props/transforms | ✓ | ✓ OpenPipeline | ~ FER |
| Extração de campo de texto livre (grok/regex) | ✓ | ✓ Grok Parser | ✓ | ✓ |
| Enriquecimento (GeoIP, user-agent, tabela de referência) | ✓ | ✓ 21 processadores | ✓ | ✓ Lookup Tables |
| Remapear nível, serviço, data, mensagem | ✓ | ✓ | ✓ | ✓ |
| Redigir dado sensível no pipeline | ✓ | ✓ Sensitive Data Scanner | ✓ | ✓ |
| Roteamento para índices/baldes diferentes | ✓ | ✓ | ✓ | ✓ |
| Extrair métrica na entrada | ~ | ✓ | ✓ | ~ |

**Nós:** redação por lista fechada, fingerprint, nível mínimo e amostragem.
Nada configurável pelo usuário, nenhuma extração de campo, nenhum
enriquecimento, nenhum roteamento. **É uma escolha defensável** — a lista
fechada existe porque regex de terceiro no caminho de 10 ms de CPU é negação de
serviço que a gente escreve sozinho, e isso já aconteceu uma vez aqui (266 ms).
Mas a consequência é que um log que não veio de um SDK nosso chega como texto e
continua texto.

### 2.3 Consulta e análise

| | Splunk | Datadog | Dynatrace | Sumo |
|---|:-:|:-:|:-:|:-:|
| Linguagem completa com pipeline | ✓ SPL/SPL2 | ~ filtro + Analytics | ✓ DQL | ✓ |
| Agregação (`count by`, `stats`, `summarize`) | ✓ | ✓ | ✓ | ✓ |
| Extrair campo na hora da consulta | ✓ | ~ Calculated Fields | ✓ schema-on-read | ✓ `parse` |
| Agrupar mensagens parecidas automaticamente | ~ | ✓ Patterns | ~ | ✓ LogReduce |
| Comparar dois períodos / achar o que é novo | ~ | ✓ | ~ | ✓ LogCompare, Time Compare |
| Explicar por que um grupo é diferente | — | ✓ Watchdog | ✓ Davis | ✓ LogExplain |
| Subconsulta / junção com tabela | ✓ | ✓ Workspaces | ✓ | ✓ Subqueries, Lookup |
| Agrupar logs de um mesmo processo (transação) | ✓ | ✓ Transaction queries | ✓ | ✓ |
| Tail ao vivo | ✓ | ✓ Live Tail | ✓ | ✓ |
| Assistente em linguagem natural | ✓ | ✓ Bits AI | ✓ Davis CoPilot | ✓ Mobot |
| Servidor MCP | — | ✓ | — | ~ comunidade |

**Nós:** filtro e só. `level:error service:api status>=500` funciona; **"os 10
serviços com mais erro na última hora" não existe**, nem na linguagem nem na
API. O histograma é um endpoint à parte com balde de lista fechada. Essa é a
maior lacuna funcional do levantamento inteiro, e é a que mais destoa do resto
do projeto, porque o ClickHouse foi escolhido exatamente por ser rápido em
agregação e hoje a plataforma não deixa ninguém agregar.

### 2.4 Visualização e compartilhamento

| | Splunk | Datadog | Dynatrace | Sumo |
|---|:-:|:-:|:-:|:-:|
| Dashboards customizáveis | ✓ | ✓ | ✓ | ✓ |
| Dashboards prontos | ✓ | ✓ | ✓ | ✓ |
| Busca salva / view salva | ✓ | ✓ | ✓ | ✓ |
| Notebook / exploração narrativa | ~ | ✓ Workspaces | ✓ Notebooks | — |
| Relatório agendado | ✓ | ✓ | ✓ | ✓ |

**Nós:** as tabelas `dashboards` e `saved_views` existem no Postgres desde a
 4.15; as telas são do `apps/dashboard` e **continuam abertas** (#93, #94).
Exportação agendada existe e é o que mais perto chega de relatório.

### 2.5 Detecção e alerta

| | Splunk | Datadog | Dynatrace | Sumo |
|---|:-:|:-:|:-:|:-:|
| Alerta por limiar sobre log | ✓ | ✓ | ✓ | ✓ |
| Alerta por anomalia / linha de base | ✓ | ✓ Watchdog | ✓ Davis | ✓ |
| Alerta por ausência de dado | ✓ | ✓ | ✓ | ✓ |
| Agrupamento de erro (error tracking) | ~ | ✓ | ✓ | ~ |
| Causa raiz automática | ~ | ✓ | ✓ | ~ |
| Janela de manutenção / silenciamento | ✓ | ✓ | ✓ | ✓ |
| Escalonamento e plantão | ✓ | ✓ | ✓ | ✓ |
| Detecção de segurança (SIEM) | ✓ | ✓ 800+ regras | ~ | ✓ |

**Nós:** cinco tipos de regra, quatro janelas, quatro canais, cooldown e
histórico — para o porte, está bem resolvido, e o `absence` e o
`issue_regression` não são óbvios. **Faltam duas coisas que todos os quatro
têm e que são baratas:** janela de manutenção (silenciar durante um deploy) e
alerta por desvio da linha de base. Escalonamento e plantão o webhook assinado
já cobre indiretamente — quem usa PagerDuty aponta o webhook para lá.

### 2.6 Retenção, custo e armazenamento

| | Splunk | Datadog | Dynatrace | Sumo |
|---|:-:|:-:|:-:|:-:|
| Retenção configurável por conjunto de dados | ✓ índices | ✓ índices | ✓ baldes Grail | ✓ partições |
| Camadas quente/morna/fria | ✓ | ✓ Flex Logs | ✓ | ✓ Data Tiers |
| Arquivo em storage próprio do cliente | ✓ | ✓ Archives | ~ | ✓ Archive |
| Pesquisar o arquivo sem reidratar | ~ | ✓ Archive Search | ✓ | ~ |
| Reidratar arquivo para o índice | — | ✓ | — | ✓ |
| Filtro de exclusão / amostragem para baratear | ✓ | ✓ | ✓ | ✓ |
| Métrica derivada de log, inclusive do não indexado | ~ | ✓ | ✓ | ~ |
| Painel de uso e previsão de custo | ✓ | ✓ | ✓ | ✓ |

**Nós:** uma retenção por ambiente, TTL no ClickHouse, cota diária e
exportação com validade de 7 dias. Não há camada fria, não há arquivo
pesquisável, não há métrica derivada definida pelo usuário. A exportação é
download, não consulta. O uso existe (`usage_per_minute`), a tela é do
dashboard.

### 2.7 Segurança, governança e acesso

| | Splunk | Datadog | Dynatrace | Sumo |
|---|:-:|:-:|:-:|:-:|
| RBAC fino, por time e por recurso | ✓ | ✓ | ✓ | ✓ |
| Restringir **quais logs** um papel vê | ✓ | ✓ Restriction Queries | ✓ por balde | ✓ |
| SSO, SAML, SCIM | ✓ | ✓ | ✓ | ~ Enterprise |
| Audit log da própria plataforma | ✓ | ✓ Audit Trail | ✓ | ✓ |
| Certificação (SOC 2, PCI, HIPAA) | ✓ | ✓ | ✓ | ✓ |
| Residência de dados por região | ✓ | ✓ | ✓ | ✓ |

**Nós:** quatro papéis fixos por organização, `audit_log` no Postgres, remoção
de dado sensível dos dois lados, IP nunca gravado. **A lacuna que importa é a
segunda linha:** na matriz da seção 10.2 do plano, *todo* papel — inclusive
`viewer` — vê log de *todos* os ambientes. Numa plataforma cujo argumento
central é privacidade, "o estagiário vê produção" é uma inconsistência interna,
não uma falta de recurso enterprise. SSO e certificação são outra conversa e
provavelmente ficam fora para sempre.

### 2.8 Correlação com o resto da observabilidade

Os quatro ligam log a métrica, trace, RUM e sinal de segurança numa tela só;
três deles têm APM próprio. **Nós temos propagação `traceparent` e uma tela de
trace (fechada, ainda aberta como etapa), e nada de métrica ou APM.** Isso é
escopo, não lacuna: o projeto se chama NekoLog e diz que é plataforma de log.
Vale só deixar escrito que é deliberado.

### 2.9 Automação e integração com fluxo de trabalho

| | Splunk | Datadog | Dynatrace | Sumo |
|---|:-:|:-:|:-:|:-:|
| API de escrita para configurar a plataforma | ✓ | ✓ | ✓ | ✓ |
| Provider Terraform | ✓ | ✓ | ✓ | ✓ |
| Servidor MCP oficial | — | ✓ | — | ~ |

**Nós:** a API pública é de leitura, com duas exceções de escrita (`releases` e
`sourcemaps`) que existem para o pipeline de deploy. Regra de alerta, view
salva e ambiente só se configuram por tela — ou seja, **só no repositório
fechado**. Para uma ferramenta de desenvolvedor isso é um buraco estranho: o
self-host tem a plataforma inteira e nenhuma forma de configurar um alerta.

---

## 3. Tabela de lacunas

Ordenada por impacto dentro do escopo declarado do projeto. "Esforço": P até
uma etapa, M duas ou três, G mais que isso. "Onde": repositório em que a maior
parte do trabalho cai.

| # | Lacuna | Têm | Aqui hoje | Impacto | Esforço | Onde |
|---|---|:-:|---|:-:|:-:|---|
| 1 | Agregação na busca (`count by`, `top`, `avg`) | 4/4 | só filtro | **Alto** | M | público |
| 2 | Agrupamento de mensagens parecidas (padrões) | 3/4 | só erro, por fingerprint | **Alto** | M | público |
| 3 | Permissão por ambiente | 4/4 | todo papel vê tudo | **Alto** | M | ambos |
| 4 | Janela de manutenção / silenciar alerta | 4/4 | só cooldown | **Alto** | P | público |
| 5 | API de escrita para configuração (alertas, views) | 4/4 | só leitura | **Alto** | M | público |
| 6 | Métrica derivada de log definida pelo usuário | 3/4 | dois rollups fixos | Médio | M | público |
| 7 | Alerta por desvio da linha de base | 4/4 | só limiar absoluto | Médio | M | público |
| 8 | Dashboards e views salvas (telas) | 4/4 | tabelas existem, tela não | Médio | M | fechado |
| 9 | Tail ao vivo de verdade | 4/4 | polling de 2–3 s previsto | Médio | P | ambos |
| 10 | Camada fria / arquivo pesquisável | 4/4 | exportação para download | Médio | G | público |
| 11 | Extração de campo de texto livre | 4/4 | nenhuma | Médio | M | público |
| 12 | Comparar dois períodos / "o que é novo" | 3/4 | nenhuma | Médio | P | público |
| 13 | Servidor MCP sobre a API de leitura | 1/4 | nenhum | Médio | P | público |
| 14 | Enriquecimento (user-agent, tabela de referência) | 4/4 | só país | Baixo | M | público |
| 15 | Transação / sessionização | 4/4 | `session_id` existe, agregação não | Baixo | M | público |
| 16 | Painel de uso e previsão | 4/4 | dado existe, tela é órfã | Baixo | P | fechado |
| 17 | Coleta fora do JS (arquivo, syslog, k8s) | 4/4 | SDK e OTLP | Baixo | G | público |
| 18 | SSO, SAML, SCIM | 4/4 | nenhum | Baixo | G | fechado |
| 19 | Correlação com métrica e APM | 4/4 | só trace | Baixo | G | ambos |
| 20 | SIEM e regras de detecção | 3/4 | nenhum | Baixo | G | — |
| 21 | Certificação e residência de dados | 4/4 | nenhuma | Baixo | — | — |

---

## 4. Requisitos propostos

Escritos no formato das etapas do [ETAPAS.md](ETAPAS.md), para caberem num M7
se você quiser. **Nenhum está decidido.**

### Prioridade alta

**R1 — `feat/search-aggregation`** (lacuna 1)
Estender a especificação 4 com uma etapa de agregação depois do filtro:
`level:error | count by service` e `| top 10 @status`. Compilar para
`GROUP BY` parametrizado sobre as mesmas colunas de `SEARCH_COLUMNS`, com a
chave de atributo continuando parâmetro e não interpolação. Expor como
`GET /v1/aggregate`, com lista fechada de funções (`count`, `avg`, `min`,
`max`, `p95`), teto de grupos retornados e o mesmo escopo de projeto e ambiente
que o resto. *Por quê:* é o que todo mundo tem, é o motivo de o banco ser
colunar, e sem isso o dashboard não consegue montar nenhum widget que não seja
o histograma.

**R2 — `feat/log-patterns`** (lacuna 2)
Uma tarefa nos jobs que agrupa mensagens por estrutura — a mesma normalização
que o fingerprint já faz (número, UUID, e-mail, caminho viram marcador), só que
para **todo** nível e não só erro — e grava uma tabela de padrões com contagem
por janela. *Por quê:* o `normaliseMessage` da especificação 5 já existe e já
foi otimizado; metade do trabalho está feita. É o recurso que mais encurta
investigação nos quatro produtos.

**R3 — `feat/env-scoped-roles`** (lacuna 3)
Papel por ambiente além de papel por organização, com a restrição entrando no
`searchWhere` do servidor e não na tela. *Por quê:* a matriz atual contradiz o
discurso de privacidade do projeto. E o lugar certo é aqui, porque é o
`searchWhere` deste repositório que monta a query — resolver isso só no
dashboard seria permissão de interface, que não é permissão.

**R4 — `feat/alert-silence`** (lacuna 4)
Janela de silenciamento por regra, por ambiente ou por projeto, com início e
fim, e registro no `alert_events` de que foi silenciada — do mesmo jeito que o
cooldown já grava `suppressed`. **O alerta de resolução não é silenciado**,
pela mesma razão que o cooldown não o segura hoje. *Por quê:* é a menor etapa
desta lista e evita o único jeito garantido de alguém desligar os alertas para
sempre, que é ser acordado por um deploy planejado.

**R5 — `feat/config-api`** (lacuna 5)
Escopo `config:write` na key secreta e rotas de escrita para regra de alerta,
canal e view salva, com o mesmo cuidado do `POST /v1/releases` (key pública
recusada pelo prefixo, idempotência, limite por projeto). *Por quê:* hoje o
self-host entrega a plataforma inteira e nenhuma forma de configurar um alerta,
porque a única interface é o dashboard fechado. Isso é um furo no argumento do
open-core, não só uma comodidade. Um provider OpenTofu vem depois e de graça,
se a API existir.

### Prioridade média

**R6 — `feat/log-metrics`** (lacuna 6): métrica definida pelo usuário a partir
de uma busca, materializada pelos jobs na mesma cadência de um minuto. Encaixa
no que já existe (`logs_per_minute`) e é o que torna dashboard barato.

**R7 — `feat/alert-baseline`** (lacuna 7): comparar a janela atual com a mesma
janela de 7 dias atrás. Nada de aprendizado de máquina — desvio sobre mediana
móvel resolve a maior parte e cabe no orçamento dos jobs. Regra de ouro do
projeto se aplica: **não conseguir medir não é "está normal"**.

**R8 — `feat/live-tail`** (lacuna 9): decidir entre SSE no `apps/api` e manter o
polling. Se for manter o polling, **escrever isso no plano como escolha**, com
o motivo (o Worker e a cota), em vez de deixar como detalhe de implementação.

**R9 — `feat/search-compare`** (lacuna 12): `compare` de dois períodos sobre a
mesma busca, devolvendo o que apareceu, o que sumiu e o que mudou de volume.
Fica quase de graça em cima do R1 e do R2.

**R10 — `feat/mcp-server`** (lacuna 13): servidor MCP sobre a API de leitura,
gerado do `/openapi.json` que já existe. É pequeno, e em 2026 é o tipo de coisa
que diferencia uma ferramenta de desenvolvedor — a Datadog já tem.

### Prioridade baixa, ou a recusar de propósito

**R11 — `feat/cold-storage`** (lacuna 10): ler de volta a exportação no R2 pelo
`s3()` do ClickHouse. **Esbarra numa decisão de segurança existente**: o usuário
`nekolog_jobs` deliberadamente não tem `READ ON S3`, justamente para não
conseguir trazer objeto para dentro do banco. Qualquer camada fria precisa de
um décimo primeiro usuário, com grant só nesse bucket, ou de uma ADR revogando
a decisão. Não dá para fazer "de leve".

**R12 — `feat/ingest-parsing`** (lacuna 11): extração de campo a partir de
texto, **só no caminho OTLP** e **só com padrões nomeados**, nunca com regex do
usuário — a mesma regra da redação, pelo mesmo motivo medido (266 ms).

**Recusar e registrar:** lacunas 17 a 21 (coleta fora do JS, SSO, APM, SIEM,
certificação). Não é falta de tempo, é escopo: um agente de arquivo é outro
produto, SSO não faz sentido numa instância por convite, APM contradiz o nome,
e certificação precisa de empresa. O valor de escrever isso é que a próxima
revisão não levanta tudo de novo.

---

## 5. O que este levantamento confirmou que já estava pendente

Nada disto é novidade — está no `ETAPAS.md` e no `PLANO.md` —, mas a comparação
mostra onde dói:

- **7 telas abertas no `apps/dashboard`.** Sem dashboard, 14 das 21 linhas
  da tabela de lacunas são inalcançáveis, porque não há onde exibi-las. É a
  dependência mais cara do projeto.
- **Cinco tarefas manuais de conta e domínio.** Enquanto não existirem, nada do
  que está pronto está ligado.
- **A meta de 5 kB do SDK de navegador segue não cumprida**, em 12,05 kB, e
  está escrita como tal.
- **`GET /v1/logs` pagina por período e não por cursor**, porque a linha não tem
  identidade. Os quatro produtos paginam por cursor. A limitação é real e a
  razão é boa; vale ficar escrita na página de referência da API, que hoje não
  explica o porquê.
