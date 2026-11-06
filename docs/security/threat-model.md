# Modelo de ameaças

- **Versão:** 2 (revisão de M6, etapa 6.5)
- **Data:** 04/11/2026 (versão 1 em 30/10/2026)
- **Acrescentado depois da revisão:** S9, e S7 saiu de "planejada" para
  "implementada", na etapa 6.7 (04/11/2026). Não é uma revisão nova: é a
  pendência que a própria versão 2 registrou, fechada. Em 05/11/2026 entraram
  **D10** e **I15**, as duas faces do backup do ClickHouse: perder a máquina
  deixou de ser perda total, e em troca passou a existir uma cópia de tudo num
  bucket de terceiro. No mesmo dia entrou a **D11**, quando o backup do Postgres
  saiu do GitHub Actions. Ainda em 05/11/2026, o item **D4** removeu a
  infraestrutura do Cloudflare Workers, da Vercel e da VM da Oracle: **E14 e
  E15 deixaram de existir junto com o que as motivava**, E13 passou a ser o
  isolamento da rede de containers, e **E9 virou parcial** — o que é container
  está fechado, mas o hardening da VPS (item B2) ainda não aconteceu, porque a
  máquina ainda não foi comprada. **O diagrama de fronteiras abaixo ainda
  descreve o desenho antigo** e é o que a versão 3 tem de refazer, quando a
  máquina existir e a superfície real for conhecida.
- **Método:** STRIDE por fronteira de confiança
- **Revisão:** a cada marco (M1…M6), e sempre que a arquitetura mudar

> **Estado:** tudo que é deste repositório existe — SDKs, ingestão, jobs, API
> pública de leitura, self-host. O dashboard não, e por isso as ameaças das
> fronteiras 3 e 4 continuam "Planejada (M2)": elas são do outro repositório.
> A coluna de status diz o que existe **de verdade e com teste**, não o que foi
> desenhado.

## O que mudou da versão 1 para a 2

A versão 1 descrevia o sistema como ele foi desenhado em M0. Desde então
apareceram superfícies que **não tinham entrada nenhuma** aqui: a API pública de
leitura (5.9), as duas rotas de escrita que ela ganhou (4.7 e 4.8), o endpoint
OTLP (6.1), o self-host (6.2) e o plugin de bundler (4.9). Estão nas linhas
novas S8, T12, I12, I13, I14, D9, E16 e E17.

Dois defeitos do próprio documento foram corrigidos: havia **duas linhas
numeradas T7** (a segunda virou T11), e uma linha em branco no meio da tabela de
*Information disclosure* fazia o I10 e o I11 saírem fora dela.

Nove itens estavam marcados como "Planejada" embora já tivessem sido entregues:
T1, D4, D5, D6, E2 e E8 foram confirmados contra o código e o teste e viraram
"Implementada"; I4 e I5 viraram "Parcial", porque a metade que falta é do
dashboard; D1 continua parcial pelo mesmo motivo.

A varredura do ZAP está na seção [Varredura do ZAP](#varredura-do-zap).

## O que estamos protegendo

| Ativo | Por que importa |
|---|---|
| **Logs dos clientes** | Podem conter dado pessoal e segredo enviado por engano. É o ativo de maior volume e o mais sensível. |
| **Credenciais de acesso** | Hash de senha, sessões, códigos de login. |
| **Keys de API** | Uma `sk` vazada permite ler ou escrever logs de um ambiente. |
| **Segredos da plataforma** | Chaves JWT, `ENCRYPTION_KEY`, senhas do ClickHouse, tokens de deploy, credenciais do R2. |
| **Os pacotes npm** | Rodam dentro da aplicação de terceiros. Um pacote comprometido compromete todos os clientes de uma vez. É o ativo de maior alcance. |
| **As cotas gratuitas** | Esgotá-las derruba a plataforma inteira (ADR [0003](../adr/0003-so-servicos-gratuitos.md)). |

## Fronteiras de confiança

```
[app do cliente]──1──►[ingest Worker]──2──►[ClickHouse na VM]
                            │
                            └──►[KV]  [R2 spool]

[navegador]──3──►[dashboard]──4──►[Postgres] [Redis] [ClickHouse]

[jobs]──5──►[webhook de terceiro]   [jobs]──►[Resend]

[GitHub Actions]──6──►[npm] [Cloudflare] [Oracle] [Vercel]

[cliente da API]──7──►[api Worker]──►[ClickHouse] [Postgres] [R2 source maps]

[uma máquina]──8──►[self-host: ingest + api + jobs + ClickHouse + Postgres]
```

1. **SDK → ingestão.** Entrada totalmente não confiável, autenticada só por key.
2. **Worker → ClickHouse.** Atravessa a internet pelo Cloudflare Tunnel.
3. **Navegador → dashboard.** Entrada não confiável, sessão autenticada.
4. **Dashboard → bancos.** Onde o isolamento entre organizações é imposto.
5. **Jobs → fora.** Saída para endereço escolhido pelo usuário (SSRF).
6. **CI → provedores e npm.** Cadeia de suprimentos.
7. **Cliente da API → API pública de leitura.** Nasceu na 5.9. Entrada não
   confiável autenticada por `sk`, que é o que define o escopo; ganhou duas
   rotas de **escrita** na 4.7 e na 4.8. É a segunda superfície de internet
   deste repositório, e a primeira que devolve conteúdo de log.
8. **Self-host.** Nasceu na 6.2. Tudo na mesma máquina e na mesma rede de
   containers, sem Cloudflare na frente: o que lá é borda de plataforma, aqui é
   responsabilidade de quem instalou.

---

## S — Spoofing (falsificação de identidade)

| # | Ameaça | Fronteira | Mitigação | Status |
|---|---|---|---|---|
| S1 | Alguém usa uma key roubada para gravar logs falsos num projeto | 1 | Só o hash SHA-256 é guardado e é por ele que a busca acontece — a key em claro nunca chega ao armazenamento; lista de origens por ambiente para as keys públicas, com curinga de subdomínio que **não** casa domínio parecido (`aexample.com` não entra por `*.example.com`); escopo `logs:write` exigido; revogação pelo dashboard | **Implementada** (etapa 1.8); revogação depende do dashboard (M2) |
| S2 | Sessão sequestrada por cookie roubado | 3 | Cookies `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`; nunca `localStorage` | Planejada (M2) |
| S3 | Refresh token copiado e usado em paralelo | 3 | Rotação a cada uso com detecção de reuso: a sessão inteira cai e a pessoa é avisada (ADR [0008](../adr/0008-jwt-curto-com-refresh-rotativo.md)) | Planejada (M2) |
| S4 | Alguém derruba a sessão alheia só conhecendo o `sid` | 3 | Token **desconhecido** é só recusado; só token **já usado** encerra a sessão | Planejada (M2) |
| S5 | Quem recebe um webhook não sabe se veio mesmo do NekoLog | 5 | `X-NekoLog-Signature`: `sha256=` mais o HMAC-SHA256 do corpo com um segredo por canal, de 32 bytes, gerado pelo servidor. O segredo que assina **não é** a chave que abre o cofre: um teste confere que a assinatura feita com a `ENCRYPTION_KEY` não bate com a que sai | **Implementada** (etapa 5.2) |
| S6 | E-mail falsificado se passando por `nekolog.io` | — | SPF, DKIM e DMARC (`p=none` → `quarantine` → `reject`); subdomínio próprio de envio | Planejada (M2) |
| S7 | Pacote npm publicado por alguém que não é o projeto | 6 | Trusted publishing: a autenticação é um token OIDC que o GitHub emite para **este** workflow deste repositório, válido por minutos. Não existe token do npm no repositório nem nos secrets, então não há o que vazar, e `internal/release` tem um teste que falha se `NPM_TOKEN`, `NODE_AUTH_TOKEN` ou um `.npmrc` aparecerem no `release.yml`. Sob trusted publishing o pnpm anexa proveniência por conta própria, nomeando o commit e o workflow que construíram cada tarball | **Implementada** (etapa 6.7; falta configurar o *trusted publisher* de cada pacote no npmjs.com, que só existe depois da conta) |
| **S8** | **Key pública reescreve o histórico de releases** — ela vai no bundle de todo navegador | 7 | `POST /v1/releases` exige o escopo `logs:write`, que **não basta sozinho**: a rota recusa uma key pública **pelo prefixo**, antes de qualquer consulta. A *check constraint* do banco obriga uma key pública a ser exatamente `['logs:write']`, então o escopo não distingue — o prefixo distingue. A CLI espelha a recusa antes de abrir o socket | **Implementada** (etapa 4.7) |
| **S9** | **Dependência nova entrando sem ninguém ver num pacote que promete não ter nenhuma** | 6 | Cada pacote publicado sai com um SBOM CycloneDX escrito do lockfile e anexado à Release dele. `core`, `cli` e `adapters` prometem zero dependências de runtime, e a promessa era só prosa: agora o SBOM responde por ela, e uma dependência transitiva chegando por um pacote que eles já usam **falha a release**. A conferência também recusa um SBOM que falta, que sobrou da versão anterior, ou que descreve algo que esta release não publica | **Implementada** (etapa 6.7) |

## T — Tampering (adulteração)

| # | Ameaça | Fronteira | Mitigação | Status |
|---|---|---|---|---|
| T1 | SQL injection pela linguagem de busca | 4, 7 | Busca vira AST e depois **SQL sempre parametrizado**. O **nome do atributo também é parâmetro**: `@orderId` vira `attributes[{p1:String}]`, nunca `attributes['orderId']` — interpolar a chave seria o único ponto de injeção da tradução inteira, já que `@a'] OR 1=1 --:x` fecha o colchete. O filtro de projeto e ambiente é injetado pelo servidor a partir da key. `search.fuzz.test.ts` com fast-check, e a varredura ativa do ZAP sobre a API pública não encontrou nada nas quatro regras de SQL injection | **Implementada** (etapa 4.1; API na 5.9) |
| T2 | Log com sequência ANSI ou caractere de controle quebrando a renderização | 3 | ANSI removido ou renderizado com segurança; escape em toda renderização; nada de `dangerouslySetInnerHTML` | Planejada (M2) |
| T3 | Injeção de fórmula em exportação CSV (`=`, `+`, `-`, `@`) executando na planilha de quem abre | 4 | O `SELECT` que gera o CSV passa **toda coluna de texto** por um `if(has([...], substring(col, 1, 1)), concat('''', col), col)`, que prefixa a célula com aspa simples. A lista de caracteres é `=`, `+`, `-`, `@`, tabulação e CR. Um teste prende a classificação de **todas** as colunas da tabela em texto ou não-texto, então uma coluna nova não entra sem guarda, e um teste de integração manda `=cmd\|/c calc` para o ClickHouse de verdade e confere que volta com a aspa no CSV e **sem** ela no JSON e no XML, onde prefixar seria corromper o dado | **Implementada** (etapa 4.12) |
| T4 | Dependência comprometida injetando código no build | 6 | pnpm sem install scripts por padrão (`allowBuilds` explícito); `minimumReleaseAge` de 3 dias; `--frozen-lockfile`; Dependabot, Renovate, e o workflow `Supply chain`, que roda `pnpm audit` e a política de licenças sobre a **árvore inteira** a cada PR — o `dependency-review` que estava aqui olhava só o que o PR mudava, e saiu junto com o CodeQL quando o repositório virou privado | **Implementada** (0.3, 0.6; trocada em 06/11/2026) |
| T5 | Action do GitHub trocada sob uma tag móvel | 6 | Actions fixadas por **SHA**; `permissions` mínimas; harden-runner | **Implementada** (0.5, 0.6) |
| T6 | Push direto reescrevendo história em branch protegida | 6 | Rulesets sem bypass para ninguém; sem force push; commits assinados em `main` e `qa` | **Implementada** (0.7) |
| T7 | Cliente foge da cota datando os eventos fora do dia corrente | 1 | O uso é contado pela `usage_per_minute`, agrupada por `received_at` (carimbado pelo servidor), e não pela `logs_per_minute`, agrupada pelo `timestamp` que o cliente escolhe. Teste de integração manda um evento datado de 2020 e confere que ele entra na contagem de hoje | **Implementada** (etapa 1.12) |
| **T11** | **Cliente grava log no projeto de outra organização** mandando `projectId`/`environmentId` no corpo | 1 | Esses campos vêm **só da key**, pelo `principal`, e nunca do payload; campos desconhecidos no corpo são ignorados pelo esquema. É o espelho de escrita da I1. *(Era numerada T7 por engano na versão 1, colidindo com a ameaça de cota.)* | **Implementada** (etapa 1.7) |
| **T12** | **Source map subido num nome que escapa do diretório** e sobrescreve o de outro projeto | 7 | A chave é `sourcemaps/<projectId>/<releaseId>/<name>`, com o **id da release, nunca a versão** — `releases_version_shape` aceita qualquer 1–200 caracteres, então uma versão pode legalmente ter `/` ou `+`, enquanto um id é `rel_` mais Crockford por construção. O nome é um segmento só, `^[A-Za-z0-9][A-Za-z0-9._-]*\.map$`: `../`, barra, ponto inicial e extensão que não é `.map` são todos recusados, e o projeto e a release passam pelo mesmo portão | **Implementada** (etapa 4.8) |
| T8 | Script de terceiro executando na página do site ou da documentação | 3 | CSP sem `'unsafe-inline'` e sem `'unsafe-eval'` em `script-src`: nonce por resposta no `apps/web` e hash por script no `apps/docs`, que é estático. `base-uri 'none'`, `object-src 'none'` e `form-action 'self'` fecham as saídas que sobram quando o `script-src` segura. Teste sobe o servidor de produção e falha se **qualquer** `<script>` da página não carregar o nonce — um script que o CSP bloquearia é tela branca, não aviso | **Implementada** (etapa 2.12) |
| T9 | Clickjacking: a página embutida num iframe de terceiro | 3 | `frame-ancestors 'none'` no CSP e `X-Frame-Options: DENY` para quem não lê CSP, nos dois sites, com teste | **Implementada** (etapa 2.12) |
| T10 | Cliente escapa da retenção datando os eventos no futuro, e os logs ficam no disco para sempre | 1 | O `TTL` da `logs` vence em `timestamp + retention_days`, e o `timestamp` é do cliente: datado em 2099, o `TTL` só venceria em 2099. A ingestão prende o `timestamp` gravado entre `received_at - (retention_days - 1h)` e `received_at + 5min`, então a retenção contratada é sempre a que vale. A diferença real vai para `clock_skew_ms`, sem perder o horário original. O mesmo limite resolve o lado oposto, que não é ataque e sim relógio quebrado: datado antes da retenção, o ClickHouse **descarta a linha no insert** — a partição nasce com zero linhas e ninguém é avisado. Teste de integração manda os dois casos pelo HTTP real e confere a linha gravada, mais um controle que insere o mesmo evento sem o limite e mostra que ele some | **Implementada** (etapa 4.11) |

## R — Repudiation (repúdio)

| # | Ameaça | Fronteira | Mitigação | Status |
|---|---|---|---|---|
| R1 | Ação sensível (criar key, remover membro, apagar projeto) sem rastro | 4 | `audit_log` no Postgres, navegável no dashboard | Planejada (M2/M5) |
| R2 | Evento de segurança passa despercebido | 4 | Muitas senhas erradas, reuso de refresh token e key revogada ainda em uso vão para o audit log e geram alerta ao operador | Planejada (M5) |
| R3 | Operador age sobre uma organização sem registro | 4 | Ações da área do operador também vão para o audit log | Planejada (M2) |

## I — Information disclosure (vazamento)

| # | Ameaça | Fronteira | Mitigação | Status |
|---|---|---|---|---|
| **I1** | **Uma organização lê os logs de outra (IDOR)** — o risco mais grave da plataforma | 4 | Permissão checada **no servidor em toda rota e toda query**; filtro de projeto e ambiente injetado pelo servidor; testes de IDOR entre organizações e de isolamento no ClickHouse | Planejada (M2) |
| I2 | Cliente envia segredo dentro do log sem perceber | 1 | Remoção por padrão no SDK **antes de sair do processo**: por chave (`password`, `token`, `authorization`, `cpf`, cartão e mais) e por valor no texto (par `chave=valor` com chave sensível, cartão com Luhn, CPF com dígito verificador, JWT, `Bearer`/`Basic`, credencial em URL, key do NekoLog). Roda **depois** do `beforeSend`, então um gancho do cliente não desfaz a remoção (ADR [0014](../adr/0014-ordem-do-pipeline-de-privacidade-do-sdk.md)). No servidor, cada ambiente pode ligar padrões nomeados (e-mail, IPv4, IPv6, telefone, CPF, CNPJ, JWT, `Bearer`, UUID, cartão) e apagar atributos por chave ou por prefixo, aplicados na ingestão **antes da gravação**. O tenant **não escreve regex**: a coluna só aceita nomes de uma lista fechada, e uma *check constraint* recusa um rótulo `regex`/`pattern`/`patternSource`. É proteção contra ReDoS, não burocracia — um regex de terceiro no caminho quente de um Worker com 10 ms de CPU é negação de serviço escrita pelo próprio usuário. Se a regra guardada não puder ser lida, a ingestão **fecha**: aplica todos os padrões em vez de nenhum | **Implementada** (SDK na etapa 1.5, servidor na 5.5) |
| I3 | Key secreta na URL aparece em log de proxy, histórico e referer | 1 | `sk` só em header; `sk` na URL é recusada com `secret_key_in_url` **antes de qualquer consulta**, então nem o hash dela é calculado | **Implementada** (etapa 1.8) |
| I4 | Arquivo de exportação no R2 acessível por quem tiver o link | 4 | O e-mail leva ao dashboard e **não carrega nada que alguém digitou** — nem o filtro, nem o nome do ambiente: só período, contagem, tamanho, validade e link, e o link só é montado a partir de uma base `https` e de um id com forma `exp_`. O bucket tem regra de ciclo de vida de 7 dias. O download autenticado é do dashboard | **Parcial** (etapas 4.12 e 4.13); o download é do dashboard |
| I5 | Source map expõe o código original do cliente | 4, 7 | O upload exige `sk` com `logs:write` e uma release que **já existe**; o mapa é guardado por um `BlobStore` com a chave da T12 e **nunca é servido** por esta API — não existe rota de leitura de source map. A resolução na exibição da issue é do dashboard (4.10) | **Parcial** (etapa 4.8); a exibição é do dashboard |
| I6 | IP do usuário final guardado junto do log (LGPD) | 1 | **IP nunca é gravado** — a linha é montada só com o país, lido do `CF-IPCountry` e validado como duas letras; nenhum header de IP é consultado em lugar nenhum do caminho, e tem teste que manda `CF-Connecting-IP` e `X-Forwarded-For` e confere que a linha gravada não contém o endereço | **Implementada** (etapa 1.9) |
| I7 | Mensagem de erro revelando estrutura interna ou existência de conta | 3 | Mensagens genéricas ("e-mail ou senha inválidos"); verificação argon2 de mentira quando o e-mail não existe, para o tempo de resposta não denunciar | Planejada (M2) |
| I8 | Segredo de webhook ou token do Slack em claro no banco | 4 | AES-256-GCM com a `ENCRYPTION_KEY` fora do banco, e o **id do canal como dado adicional autenticado**: um segredo copiado para outra linha não abre. A *check constraint* `alert_channels_a_secret_is_never_stored_in_the_clear` recusa qualquer coisa que não tenha o formato `v1.<nonce hex>.<cifra hex>`, então um segredo em claro não entra na coluna nem por engano | **Implementada** (etapa 5.2) |
| I9 | Segredo commitado por engano | 6 | Secret scanning com push protection e padrões próprios para `nekolog_sk_`/`nekolog_pk_`; `.env` fora do Git | **Parcial** — scanning ativo; padrões próprios pendentes |
| I10 | Estado do OpenTofu guarda o segredo do túnel e o *client secret* do Access em claro | 2 | Criptografia nativa do OpenTofu com `enforced = true` para estado **e** plano, nas cinco raízes; a chave vem de `TF_ENCRYPTION`, nunca do código, e os jobs de `plan` e `apply` falham de cara se ela estiver vazia. Uma guarda no workflow recusa um `backend.tf` que deixe de exigir | **Código escrito** (etapa 1.16); vale a partir do primeiro `apply` |
| **I12** | **Uma key lê logs fora do próprio ambiente pela API pública** — é a I1 vista da fronteira 7 | 7 | O escopo vem **só da key**: `apps/api` passa o `projectId` e o `environmentId` do `principal` para o `searchWhere` e para o `sqlIssueReader`, e `env:` dentro da busca é **recusado com 400** em vez de ignorado, porque um filtro que silenciosamente não faz nada se lê como um filtro que funciona. Desde a 6.5, **todo parâmetro de query que a rota não tem também é recusado**, nomeando os que ela tem: antes, `?project=prj_2` era ignorado em silêncio e o chamador acreditava ter mudado o escopo. `params.test.ts` prende a lista de cada rota contra o OpenAPI que ela publica | **Implementada** (etapa 5.9; parâmetros desconhecidos na 6.5) |
| **I13** | **Conteúdo de log servido como JSON é interpretado como HTML pelo navegador** — log é entrada não confiável | 7 | `X-Content-Type-Options: nosniff` em toda resposta dos dois apps, `Cross-Origin-Resource-Policy: same-origin` na API (onde o corpo é o log de um tenant) e `Cache-Control: no-store`, de um lugar só, o `@internal/security-headers`. Há teste conferindo que eles aparecem também no 400, no 404, no 429 e no 503 — onde um corpo é menos esperado. Achado pela varredura do ZAP (6.5) | **Implementada** (etapa 6.5) |
| **I14** | **No self-host, tudo divide uma máquina e as portas são publicadas no host** | 8 | As montagens do compose são **assimétricas e testadas**: a ingestão lê o KV e a seed somente-leitura, só os jobs escrevem no KV, só o bootstrap escreve a seed, e só a API escreve os source maps. O ClickHouse e o Postgres não publicam porta. Nenhuma key em claro é escrita no Postgres pelo `sync-db`, só hashes. O que fica com quem instalou está na linha de aceitas abaixo | **Parcial** (etapa 6.2) |
| **I15** | **O backup é uma cópia completa de todos os logs de todos os clientes num bucket de terceiro** | 8 | A credencial que escreve é só dela: `nekolog_backup` tem `BACKUP ON nekolog.*`, `WRITE ON S3` e `SELECT ON system.backups`, e **não consegue ler uma linha** — medido contra o ClickHouse de verdade, não deduzido. Nenhum outro usuário aqui alcança object store nenhum. As credenciais do bucket vão dentro do statement, que o ClickHouse mascara como `[HIDDEN]` no `system.backups`, mas **não mascara em texto de erro**: a tarefa passa todo motivo pelo `reasonFrom` antes de alertar, e corta o stack trace. Quem instalou escolhe o bucket e responde por ele. **O dump do Postgres vai cifrado com `age` e o do ClickHouse não vai**, e essa assimetria é deliberada: só a metade pública da chave fica na máquina, então quem entra nela alcança o bucket e não lê o Postgres — enquanto o backup do ClickHouse é escrito pelo próprio servidor e vale o que valer o controle de acesso do bucket | **Parcial** (B8 e B9) |
| I11 | Segredo do Worker acaba no repositório ou no log do deploy | 5 | A configuração do `wrangler` não carrega segredo: `assertNoSecretVars` recusa um nome que esteja no manifesto ou que leia como segredo, e o teste de cada app roda essa verificação. No deploy, os valores vão num arquivo `0600` apagado no fim do passo, e o CLI não imprime valor em nenhuma mensagem — nem a de erro de parse, que o `JSON.parse` do Node devolveria com o texto da entrada dentro | Implementada (`internal/deploy`, etapa 1.18) |

## D — Denial of service

| # | Ameaça | Fronteira | Mitigação | Status |
|---|---|---|---|---|
| D1 | Volume de logs estoura a cota gratuita e derruba a plataforma para todos | 1 | Cota diária por ambiente, calculada a cada minuto pelo `quota-block` a partir da `usage_per_minute`, com a lista de bloqueados num documento do KV que a ingestão lê e responde `429 quota_exceeded`; rate limit em memória no Worker para rajada | **Implementada** (etapa 1.12); a soma por organização depende do `internal/db` (M2) |
| D2 | Bots criando conta esgotam os 100 e-mails/dia da Resend | 3 | Instância **só por convite**; Turnstile no cadastro, login e recuperação; espera de 60 s e máximo de 5 envios por hora por conta | Planejada (M2) |
| D3 | Lote gigante ou bomba de descompressão gzip | 1 | Três tetos em `apps/ingest`: `Content-Length` declarado, leitura do corpo e **saída do descompressor**, todos em 512 KB, com `413` e código estável. A leitura para no primeiro byte acima do limite em vez de terminar de encher a memória. Máximo de 500 eventos pelo esquema | **Implementada** (etapa 1.7) |
| D4 | Query de busca cara travando o ClickHouse | 4, 7 | Limites na linguagem: 1.000 caracteres, 20 condições, 5 níveis de parênteses, com um teste que prende **os números literais que a especificação 4 escreve**, não outra cópia da constante. Na API, o período é no máximo 31 dias, o histograma recusa um balde que daria mais de 1.500 pontos, e `limit` tem teto por rota | **Implementada** (etapa 4.1; tetos da API na 5.9) |
| D5 | Disco da VM enche e o ClickHouse para | 2 | TTL por linha (`retention_days`) e a tarefa `capacity-watch`, que lê o spool no R2 e a `system.disks` e **alerta quando não consegue medir** — um disco que não respondeu não é um disco saudável. O *grant* da `system.disks` para a credencial de jobs estava faltando nos três arquivos de usuários, e a tarefa reportava "não consigo medir" em dev, na VM e no self-host; `grants.test.ts` agora prende as duas metades | **Implementada** (etapa 2.24) |
| D6 | ClickHouse fora do ar faz perder logs recebidos | 2 | Contingência no R2 (`spool/`) e reenvio pelos jobs, com `<ambiente>:<batchId>` como token de deduplicação. O binding `SPOOL` é obrigatório: o Worker de ingestão não sobe sem ele. Lote que o ClickHouse nunca vai aceitar (`400`) vai para `quarantine/` em vez de travar a fila. O acúmulo e o lote reenviado **mas não apagado** viram alerta de operador no Discord, este último como crítico, porque a próxima execução grava de novo | **Implementada** (etapas 1.11, 2.24 e 5.8) |
| D7 | Força bruta de senha | 3 | Por conta: 5 erros em 15 min ativam espera crescente (1→15 min); por IP: 20 tentativas em 15 min; código de login com 5 tentativas | Planejada (M2) |
| **D9** | **Lote montado para custar o orçamento inteiro de CPU do Worker** | 1 | Medido na etapa 6.4: o maior lote que a especificação 1 permite — 500 eventos, 20% de erros, gzip, todas as regras de redação ligadas — custava **10,8 ms**, contra 10 ms de orçamento. O fingerprint passou a ser memoizado por lote e o padrão do SDK caiu para 200 eventos (o limite do protocolo continua 500). `apps/ingest/src/budget.test.ts` mede o pior lote legal e falha tanto por um teto absoluto quanto, de forma independente de máquina, se o custo deixar de crescer linearmente com o lote. O resíduo está na lista de aceitas | **Parcial** (etapa 6.4) |
| **D11** | **O backup do Postgres depende de uma conta do GitHub alcançar o banco** | 8 | O dump saiu do Actions em 05/11/2026 e roda na própria máquina, no container `backup`, porque o Postgres da VPS não publica porta nenhuma e um runner só o alcançaria com o banco exposto na internet. Ao rodar de verdade pela primeira vez descobriu-se que **nunca teria funcionado**: a connection string ia inteira em `PGDATABASE`, que a libpq lê como nome de banco e não como URI, então o `pg_dump` tentava o socket local. `pgEnvFrom` quebra a URI nas variáveis que a libpq lê, e nenhuma credencial entra em argumento de processo | **Implementada** (B9) |
| **D10** | **A máquina ou o disco se perde e vai todo log junto** | 8 | `BACKUP DATABASE` diário para um bucket **fora da máquina**, pela tarefa `clickhouse-backup`. Ela não guarda estado próprio: pergunta ao `system.backups` o que já aconteceu no dia UTC. Se já há um pronto ou em andamento, não faz nada; se a última tentativa falhou, **alerta e tenta de novo**; se não consegue nem ler o histórico, **alerta e não começa nada** — a mesma regra do `quota-block` e do `capacity-watch`. Cada tentativa tem nome próprio com o momento dentro, porque o ClickHouse recusa escrever por cima de um backup existente. Verificado ponta a ponta: backup, restauração noutro banco e contagens iguais | **Parcial** — o código está pronto e **configurar é opcional**; sem bucket não há backup, e o container diz isso em toda partida. A retenção é regra de ciclo de vida no bucket, porque o ClickHouse não apaga objeto em S3 |
| D8 | Payload montado para o validador lançar exceção, virando `500` que o SDK retenta para sempre | 1 | Valor que vem do cliente nunca é convertido em texto por coerção (`String(x)` lança em `{"toString":""}`): o `describeValue` do `@internal/schema` reporta tipo, não valor. O risco não é o `500` em si — é que `decisionForStatus` manda retentar `5xx`, então um lote que nunca vai ser aceito voltaria em loop. *Fuzzing* com fast-check (etapa 1.14) exige que o validador nunca lance | **Implementada** (etapa 1.14) |

## E — Elevation of privilege

| # | Ameaça | Fronteira | Mitigação | Status |
|---|---|---|---|---|
| E1 | `viewer` executa ação de `admin` chamando a API direto | 4 | Matriz de permissões num único arquivo (`permissions.ts`), aplicada no servidor, **com um teste por célula da tabela** | Planejada (M2) |
| E2 | Key pública usada para **ler** logs | 1, 7 | A ingestão não lê nada. Na API pública, uma key pública é recusada **pelo prefixo**, antes do escopo, porque ela vai no bundle de todo navegador; a leitura exige `sk` com `logs:read`, e só `GET` é roteado, então um `POST` em `/v1/logs` é 404 e não erro de método. A credencial do ClickHouse é a `nekolog_reader`: `SELECT` num banco só, sem S3, sem `system`, e sem binding de R2 no `wrangler.json` | **Implementada** (etapa 5.9) |
| E3 | Sessão da demo escapa do modo somente leitura | 4 | Papel de viewer garantido **no servidor**, não na interface | Planejada (M2) |
| E4 | Não-operador acessa `/operator` | 4 | `is_operator` checado no servidor, com re-autenticação por senha; operador vê uso, **nunca o conteúdo dos logs** | Planejada (M2) |
| E5 | Header repassado pelo proxy (`x-user-id`) usado como identidade | 4 | Nenhum header do proxy é confiável; **todo route handler revalida o JWT** | Planejada (M2) |
| E6 | Admin se promove a owner | 4 | Admin não pode promover a owner nem alterar/remover um owner | Planejada (M2) |
| E7 | SSRF: webhook de alerta apontado para a rede interna ou para o metadata da nuvem | 5 | `assertWebhookTarget` recusa tudo que não seja `https` na porta 443, endereço com credenciais, `localhost`, `*.local`, `*.internal`, `*.lan`, `*.home.arpa`, `*.in-addr.arpa`, `metadata.google.internal`, `instance-data`, nome sem ponto nenhum (que só existe nesta rede), IPv4 privado ou reservado (10/8, 127/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 192.0.0/24, 198.18/15, multicast, broadcast) e IPv6 privado ou reservado (`::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, `::ffff:`). A checagem roda **de novo na hora de enviar**, não só quando a linha é escrita, porque a linha pode ser mais velha que a proteção. O `fetch` vai com `redirect: 'manual'` — senão um endereço público responde 302 para um privado — e com um `AbortSignal` de 5 s | **Implementada** (etapa 5.2) |
| E8 | Nome de arquivo de source map com `../` escrevendo fora do destino | 7 | Ver **T12** para a chave e o nome. O tamanho máximo é 8 MB, conferido tanto pelo `Content-Length` declarado quanto pelo que chegou, e o corpo é **conferido, não parseado**: os primeiros 4 KB têm que abrir um objeto JSON e nomear `mappings` ou `sections`, e uma `version` declarada tem que ser 3 — parsear megabytes de JSON não cabe no orçamento de CPU de um Worker. Uma release só aceita 200 mapas | **Implementada** (etapa 4.8) |
| **E16** | **OTLP como segunda porta de entrada, contornando os controles da primeira** | 1 | Não existe segunda porta: `POST /v1/otlp/logs` **traduz para a especificação 1 antes de qualquer outra coisa**, e daí em diante o registro passa pela mesma validação, pelo mesmo fingerprint, pelo mesmo nível mínimo, pela mesma amostragem e pela mesma redação que um lote nativo. A resposta é a do OTLP (`{partialSuccess}`), porque um exportador lê `202` ou um corpo estranho como falha e retenta | **Implementada** (etapa 6.1) |
| **E17** | **Key secreta dentro de um build cuja saída vai para o navegador** | 6 | O `@nekolog-io/bundler-plugin` **não tem** `transform`, `load` nem `resolveId` — só `writeBundle`. Não é uma regra que alguém precisa lembrar: é a ausência do mecanismo, e um teste falha se um desses hooks aparecer. No Vite ele é `apply: 'build'`, então o servidor de desenvolvimento nunca sobe nada, e nada é validado enquanto a config é lida, para uma key errada não impedir o `vite dev` de subir | **Implementada** (etapa 4.9) |
| E9 | Máquina invadida por porta exposta | 2 | O `docker-compose.yml` do self-host publica **só** 80 e 443, do Caddy; o ClickHouse, o Postgres, a ingestão, a API e os jobs existem só na rede dos containers. O que falta é a metade que não é código: SSH só por chave, firewall e atualização automática na máquina, que é o item **B2** e **ainda não foi feito** — não existe máquina ainda | **Parcial**: o que é container está fechado; o hardening do host é o B2 |
| E10 | Credencial do ClickHouse vazada de um app faz mais do que aquele app precisa | 2 | Um usuário por papel, com *grant* mínimo: leitura, ingestão, jobs, backup e migrations são credenciais distintas, e só a de migrations tem DDL. Vale no dev (`deploy/clickhouse-users.dev.xml`) e no self-host (`deploy/self-host/clickhouse-users.xml`), e `packages/clickhouse/src/grants.test.ts` lê os dois arquivos e falha se algum *grant* alargar | **Implementada** |
| E11 | Credencial de ingestão lê o conteúdo dos logs | 1 | O usuário de ingestão tem `INSERT` em `logs` e `SELECT` **só nas seis colunas** que as *materialized views* leem (`project_id`, `environment_id`, `timestamp`, `received_at`, `level`, `service`); `message`, `stacktrace`, `attributes` e `user_id` ficam fora do alcance. O `received_at` entrou na etapa 1.12, com a *materialized view* de uso. Vale no dev e no self-host, e `packages/clickhouse/src/grants.test.ts` falha se algum desses *grants* alargar | **Implementada** |
| E12 | Qualquer um dispara as tarefas agendadas pela URL pública do Worker de jobs | 5 | O app de jobs expõe **só** `GET /health`; nenhuma rota executa tarefa, e um teste falha se alguém adicionar uma. O gatilho é o Cron Trigger do Cloudflare, que não chega pela internet | Implementada (`apps/jobs/src/app.ts`) |
| E13 | Quem descobrir o endereço do ClickHouse fala direto com ele | 2 | O ClickHouse não tem porta publicada: ele existe só na rede dos containers, e quem fala com ele é a ingestão, a API e os jobs, cada um com a sua credencial (E10). Não há mais túnel nem Access porque não há mais máquina remota a atravessar — o banco está na mesma máquina que os apps | **Implementada** |
| E14 | ~~Um token de serviço abre uma sessão SSH na VM~~ | — | Era a aplicação Access na frente do `sshd` da VM da Oracle. **A VM não existe mais**: o acesso à VPS é SSH direto, e protegê-lo é o item B2 (chave só, firewall), ainda não feito | **Removida** em 05/11/2026 com `infra/vm`; substituída pelo B2 |
| E15 | ~~Worker alcançado por um endereço `workers.dev`~~ | — | Era a garantia de que `workers_dev` e `preview_urls` ficassem `false`. **Não há mais Workers**: a ingestão e a API são containers atrás do Caddy, e o único caminho de fora é 443 num nome que o `infra/vps` publica | **Removida** em 05/11/2026 com os Workers |

---

## Ameaças aceitas sem mitigação completa

Registrar o que **não** está coberto é tão importante quanto o que está.

- **A key pública é visível por qualquer pessoa.** É inerente ao SDK de browser.
  Defesa é origem permitida, rate limit e cota — não sigilo
  (ADR [0006](../adr/0006-keys-por-ambiente.md)).
- **Revogação de key leva até ~60 s** para valer em todo lugar, por causa do
  cache do KV no Worker.
- **Revogação de sessão leva até 10 min** para ações comuns, porque o access
  token é validado só pela assinatura. Ações sensíveis conferem o Redis na hora
  (ADR [0008](../adr/0008-jwt-curto-com-refresh-rotativo.md)).
- **Janela de graça de 30 s no refresh token**: um token roubado ainda funciona
  nesse intervalo. É o preço de não quebrar uso com várias abas.
- **O `202` da ingestão não garante gravação.** A contingência cobre ClickHouse
  fora do ar, mas um bug no caminho do `waitUntil` perderia dados em silêncio.
  O teste de carga da etapa 6.4 passou a conferir isso de verdade: 1.338 lotes
  de 200 eventos viraram 267.600 linhas no ClickHouse, perda zero. Foi assim que
  se descobriu que a primeira versão do teste media nada — ela reenviava o mesmo
  `batchId` e a deduplicação descartava tudo depois do primeiro.
- **No lote máximo não sobra folga de CPU.** Depois da 6.4, 500 eventos custam
  9,1 ms de um orçamento de 10 ms. Quem pede 500 está pedindo o limite, e o
  padrão do SDK é 200 justamente por isso. Um cliente que insista em lotes de
  500 com erros todos distintos pode fazer o próprio request estourar o
  orçamento — e quem paga a conta é a cota do projeto, não a de outro tenant,
  porque cada request é uma invocação própria.
- **A redação do servidor não foi otimizada**, embora seja o segundo maior custo
  de CPU da ingestão. Toda otimização plausível ali é uma heurística que pula
  valores, e um controle de privacidade que silenciosamente deixa de redigir é
  pior que um que redige demais.
- **No self-host, a rede é de quem instalou.** O compose publica a ingestão, a
  API e os jobs em portas do host, em HTTP puro: não há Cloudflare na frente,
  não há Access, não há WAF. O guia manda pôr um proxy reverso com certificado,
  e a CLI recusa mandar uma key secreta em `http://` para qualquer coisa que não
  seja esta máquina. O que não dá para fazer daqui é impedir alguém de expor a
  porta 8787 na internet sem TLS.
- **A API pública não manda `Cross-Origin-Resource-Policy` na ingestão**, só na
  leitura. A resposta da ingestão é `{"accepted":N}` — não há o que proteger de
  embutimento — e é a única rota com cliente de navegador, onde a saída por
  `sendBeacon` acontece durante o unload da página e não pode ser retentada.
  Benefício zero contra risco não-zero no único caminho sem segunda chance. Está
  registrado em `docs/security/zap/ingest.conf`.
- **Autenticação escrita à mão** assume uma classe inteira de risco que uma
  biblioteca pronta evitaria (ADR [0007](../adr/0007-autenticacao-propria.md)).
  Compensação: testes da seção 11.11 do plano, ASVS nível 2 e revisão dedicada
  antes da demo pública.
- **Uma pessoa só revisa os PRs.** O GitHub não permite aprovar o próprio PR,
  então não há revisão obrigatória até entrar um segundo mantenedor.
- **`style-src 'unsafe-inline'` na documentação.** O Starlight escreve centenas
  de atributos `style="…"` nas páginas, e atributo de estilo não é coberto por
  hash nem por nonce — só por `'unsafe-inline'`. O `script-src` continua preso a
  `'self'` mais a lista de hashes, que é onde mora o XSS; o que se aceita aqui é
  CSS injetado, num site cujo conteúdo todo vem deste repositório. O gerador
  **recusa** escrever a política se um elemento `<style>` aparecer no build,
  porque um hash ali faria o navegador ignorar o `'unsafe-inline'` e quebrar as
  centenas de atributos em silêncio (etapa 2.12).

### O CodeQL e o Scorecard saíram

Em 06/11/2026 o CodeQL, o `dependency-review` e o OpenSSF Scorecard foram
removidos do repositório. Não foi escolha de postura: repositório privado sem
GitHub Advanced Security não aceita upload de SARIF (`Resource not accessible by
integration`) nem roda o `dependency-review` (`Dependency review is not
supported on this repository`), e o Scorecard pontua projeto aberto. A ADR
[0017](../adr/0017-licenca-proprietaria-e-repositorio-privado.md) já tinha
aceitado essa consequência.

O que entrou no lugar está na T4: o workflow `Supply chain`, com `pnpm audit` e
a política de licenças sobre a árvore inteira em todo PR. **Análise estática do
código não foi substituída** — ver [README.md](README.md#o-que-saiu-e-o-que-não-foi-substituído).

Os achados de maturidade do Scorecard que esta página registrava como aceitos
(projeto de uma pessoa, `main` sem aprovadores exigidos, repositório novo, sem
selo OpenSSF) deixaram de ser medidos. O único que valia a pena guardar é o
raciocínio, que continua valendo: **exigir aprovador travaria o único
mantenedor**, e o que dá para proteger está protegido — sem deleção, sem
force-push, PR e status checks obrigatórios, assinatura exigida na `main` e na
`qa`, ninguém com bypass.

## Varredura do ZAP

Rodada em 04/11/2026 contra a ingestão e a API pública subindo como processos
Node, com o OWASP ZAP em Docker. Como rodar está em
[zap/README.md](zap/README.md).

| Alvo | URLs | Passou | Falhou | Avisou | Ignorado |
|---|---|---|---|---|---|
| Ingestão (`POST /v1/logs`, `/v1/otlp/logs`) | 152 | 118 | 0 | 0 | 1 |
| API pública (pelo próprio `/openapi.json`) | 45 | 120 | 0 | 0 | 0 |

A varredura é **ativa**, não só passiva: as quatro regras de SQL injection, as
seis de XSS, CRLF injection, Log4Shell, Spring4Shell, expansão exponencial de
entidade e descoberta de arquivo escondido passaram todas nas duas superfícies.

Ela achou duas coisas de verdade, as duas corrigidas nesta etapa e registradas
como **I13**: faltava `X-Content-Type-Options` e faltava
`Cross-Origin-Resource-Policy`. O único item ignorado é o CORP na ingestão, com
o motivo escrito em [zap/ingest.conf](zap/ingest.conf) e na lista de aceitas.

O que **não** foi varrido: o dashboard (outro repositório) e os ambientes `qa` e
de produção, que não existem — a varredura a cada promoção que o plano pede
depende de o deploy ser ligado.

## Próxima revisão

**Quando o dashboard existir.** Quase toda linha ainda marcada "Planejada (M2)"
é dele: sessão (S2, S3, S4), audit log (R1, R2, R3), IDOR entre organizações
(I1), mensagem de erro genérica (I7), força bruta (D7) e a matriz de permissões
inteira (E1, E3, E4, E5, E6). Nessa revisão, confirmar cada uma contra o código
de lá e rodar o ZAP contra a interface, que é onde mora o XSS.

Também nessa revisão, ou antes dela se o deploy for ligado: as linhas marcadas
"Código escrito" (I10, E9, E10, E11, E13, E14) só valem a partir do primeiro
`apply`, e precisam ser confirmadas contra a infraestrutura de verdade.

Pendência desta revisão que não virou código: os padrões próprios de secret
scanning (I9). O trusted publishing (S7) saiu na etapa 6.7, junto com o SBOM
por pacote (S9).
