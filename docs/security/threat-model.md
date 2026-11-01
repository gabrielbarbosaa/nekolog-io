# Modelo de ameaças

- **Versão:** 1 (primeira versão, M0)
- **Data:** 30/10/2026
- **Método:** STRIDE por fronteira de confiança
- **Revisão:** a cada marco (M1…M6), e sempre que a arquitetura mudar

> **Estado:** a maior parte da plataforma ainda não existe. Este documento
> descreve as ameaças do sistema **como ele foi desenhado**, e serve para que
> cada mitigação seja implementada junto com a funcionalidade, não depois. A
> coluna de status diz o que já existe de verdade.

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
```

1. **SDK → ingestão.** Entrada totalmente não confiável, autenticada só por key.
2. **Worker → ClickHouse.** Atravessa a internet pelo Cloudflare Tunnel.
3. **Navegador → dashboard.** Entrada não confiável, sessão autenticada.
4. **Dashboard → bancos.** Onde o isolamento entre organizações é imposto.
5. **Jobs → fora.** Saída para endereço escolhido pelo usuário (SSRF).
6. **CI → provedores e npm.** Cadeia de suprimentos.

---

## S — Spoofing (falsificação de identidade)

| # | Ameaça | Fronteira | Mitigação | Status |
|---|---|---|---|---|
| S1 | Alguém usa uma key roubada para gravar logs falsos num projeto | 1 | Só o hash SHA-256 é guardado e é por ele que a busca acontece — a key em claro nunca chega ao armazenamento; lista de origens por ambiente para as keys públicas, com curinga de subdomínio que **não** casa domínio parecido (`aexample.com` não entra por `*.example.com`); escopo `logs:write` exigido; revogação pelo dashboard | **Implementada** (etapa 1.8); revogação depende do dashboard (M2) |
| S2 | Sessão sequestrada por cookie roubado | 3 | Cookies `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`; nunca `localStorage` | Planejada (M2) |
| S3 | Refresh token copiado e usado em paralelo | 3 | Rotação a cada uso com detecção de reuso: a sessão inteira cai e a pessoa é avisada (ADR [0008](../adr/0008-jwt-curto-com-refresh-rotativo.md)) | Planejada (M2) |
| S4 | Alguém derruba a sessão alheia só conhecendo o `sid` | 3 | Token **desconhecido** é só recusado; só token **já usado** encerra a sessão | Planejada (M2) |
| S5 | Quem recebe um webhook não sabe se veio mesmo do NekoLog | 5 | `X-NekoLog-Signature`: HMAC-SHA256 do corpo com segredo por canal | Planejada (M5) |
| S6 | E-mail falsificado se passando por `nekolog.io` | — | SPF, DKIM e DMARC (`p=none` → `quarantine` → `reject`); subdomínio próprio de envio | Planejada (M2) |
| S7 | Pacote npm publicado por alguém que não é o projeto | 6 | Trusted publishing (OIDC), sem token guardado; provenance | Planejada (M1+) |

## T — Tampering (adulteração)

| # | Ameaça | Fronteira | Mitigação | Status |
|---|---|---|---|---|
| T1 | SQL injection pela linguagem de busca | 4 | Busca vira AST e depois **SQL sempre parametrizado**; filtro de projeto e ambiente injetado pelo servidor, nunca pelo usuário; fuzzing do parser | Planejada (M4) |
| T2 | Log com sequência ANSI ou caractere de controle quebrando a renderização | 3 | ANSI removido ou renderizado com segurança; escape em toda renderização; nada de `dangerouslySetInnerHTML` | Planejada (M2) |
| T3 | Injeção de fórmula em exportação CSV (`=`, `+`, `-`, `@`) executando na planilha de quem abre | 4 | Prefixar célula suspeita; teste dedicado | Planejada (M4) |
| T4 | Dependência comprometida injetando código no build | 6 | pnpm sem install scripts por padrão (`allowBuilds` explícito); `minimumReleaseAge` de 3 dias; `--frozen-lockfile`; Dependabot, Renovate, `dependency-review`, CodeQL | **Implementada** (0.3, 0.6) |
| T5 | Action do GitHub trocada sob uma tag móvel | 6 | Actions fixadas por **SHA**; `permissions` mínimas; harden-runner | **Implementada** (0.5, 0.6) |
| T6 | Push direto reescrevendo história em branch protegida | 6 | Rulesets sem bypass para ninguém; sem force push; commits assinados em `main` e `qa` | **Implementada** (0.7) |
| T7 | Cliente foge da cota datando os eventos fora do dia corrente | 1 | O uso é contado pela `usage_per_minute`, agrupada por `received_at` (carimbado pelo servidor), e não pela `logs_per_minute`, agrupada pelo `timestamp` que o cliente escolhe. Teste de integração manda um evento datado de 2020 e confere que ele entra na contagem de hoje | **Implementada** (etapa 1.12) |
| **T7** | **Cliente grava log no projeto de outra organização** mandando `projectId`/`environmentId` no corpo | 1 | Esses campos vêm **só da key**, pelo `principal`, e nunca do payload; campos desconhecidos no corpo são ignorados pelo esquema. É o espelho de escrita da I1 | **Implementada** (etapa 1.7) |

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
| I2 | Cliente envia segredo dentro do log sem perceber | 1 | Remoção por padrão no SDK **antes de sair do processo**: por chave (`password`, `token`, `authorization`, `cpf`, cartão e mais) e por valor no texto (par `chave=valor` com chave sensível, cartão com Luhn, CPF com dígito verificador, JWT, `Bearer`/`Basic`, credencial em URL, key do NekoLog). Roda **depois** do `beforeSend`, então um gancho do cliente não desfaz a remoção (ADR [0014](../adr/0014-ordem-do-pipeline-de-privacidade-do-sdk.md)). Regras extras por ambiente, no servidor, ficam para M5 | **Parcial** — SDK feito (etapa 1.5); servidor pendente (M5) |
| I3 | Key secreta na URL aparece em log de proxy, histórico e referer | 1 | `sk` só em header; `sk` na URL é recusada com `secret_key_in_url` **antes de qualquer consulta**, então nem o hash dela é calculado | **Implementada** (etapa 1.8) |
| I4 | Arquivo de exportação no R2 acessível por quem tiver o link | 4 | E-mail leva ao dashboard, não ao arquivo; download exige login e permissão no ambiente; ciclo de vida apaga em 7 dias | Planejada (M4) |
| I5 | Source map expõe o código original do cliente | 4 | Upload autenticado; resolução só na exibição da issue, para quem tem permissão | Planejada (M4) |
| I6 | IP do usuário final guardado junto do log (LGPD) | 1 | **IP nunca é gravado** — a linha é montada só com o país, lido do `CF-IPCountry` e validado como duas letras; nenhum header de IP é consultado em lugar nenhum do caminho, e tem teste que manda `CF-Connecting-IP` e `X-Forwarded-For` e confere que a linha gravada não contém o endereço | **Implementada** (etapa 1.9) |
| I7 | Mensagem de erro revelando estrutura interna ou existência de conta | 3 | Mensagens genéricas ("e-mail ou senha inválidos"); verificação argon2 de mentira quando o e-mail não existe, para o tempo de resposta não denunciar | Planejada (M2) |
| I8 | Segredo de webhook ou token do Slack em claro no banco | 4 | AES-256-GCM com `ENCRYPTION_KEY` fora do banco | Planejada (M5) |
| I9 | Segredo commitado por engano | 6 | Secret scanning com push protection e padrões próprios para `nekolog_sk_`/`nekolog_pk_`; `.env` fora do Git | **Parcial** — scanning ativo; padrões próprios pendentes |

| I10 | Estado do OpenTofu guarda o segredo do túnel e o *client secret* do Access em claro | 2 | Criptografia nativa do OpenTofu com `enforced = true` para estado **e** plano, nas cinco raízes; a chave vem de `TF_ENCRYPTION`, nunca do código, e os jobs de `plan` e `apply` falham de cara se ela estiver vazia. Uma guarda no workflow recusa um `backend.tf` que deixe de exigir | **Código escrito** (etapa 1.16); vale a partir do primeiro `apply` |
| I11 | Segredo do Worker acaba no repositório ou no log do deploy | 5 | A configuração do `wrangler` não carrega segredo: `assertNoSecretVars` recusa um nome que esteja no manifesto ou que leia como segredo, e o teste de cada app roda essa verificação. No deploy, os valores vão num arquivo `0600` apagado no fim do passo, e o CLI não imprime valor em nenhuma mensagem — nem a de erro de parse, que o `JSON.parse` do Node devolveria com o texto da entrada dentro | Implementada (`internal/deploy`, etapa 1.18) |

## D — Denial of service

| # | Ameaça | Fronteira | Mitigação | Status |
|---|---|---|---|---|
| D1 | Volume de logs estoura a cota gratuita e derruba a plataforma para todos | 1 | Cota diária por ambiente, calculada a cada minuto pelo `quota-block` a partir da `usage_per_minute`, com a lista de bloqueados num documento do KV que a ingestão lê e responde `429 quota_exceeded`; rate limit em memória no Worker para rajada | **Implementada** (etapa 1.12); a soma por organização depende do `internal/db` (M2) |
| D2 | Bots criando conta esgotam os 100 e-mails/dia da Resend | 3 | Instância **só por convite**; Turnstile no cadastro, login e recuperação; espera de 60 s e máximo de 5 envios por hora por conta | Planejada (M2) |
| D3 | Lote gigante ou bomba de descompressão gzip | 1 | Três tetos em `apps/ingest`: `Content-Length` declarado, leitura do corpo e **saída do descompressor**, todos em 512 KB, com `413` e código estável. A leitura para no primeiro byte acima do limite em vez de terminar de encher a memória. Máximo de 500 eventos pelo esquema | **Implementada** (etapa 1.7) |
| D4 | Query de busca cara travando o ClickHouse | 4 | Limites na linguagem: 1.000 caracteres, 20 condições, 5 níveis de parênteses | Planejada (M4) |
| D5 | Disco da VM enche e o ClickHouse para | 2 | TTL por linha (`retention_days`); alerta de disco acima de 80%; monitor externo | Planejada (M2) |
| D6 | ClickHouse fora do ar faz perder logs recebidos | 2 | Contingência no R2 (`spool/`) e reenvio pelos jobs, com `<ambiente>:<batchId>` como token de deduplicação. O binding `SPOOL` é obrigatório: o Worker de ingestão não sobe sem ele. Lote que o ClickHouse nunca vai aceitar (`400`) vai para `quarantine/` em vez de travar a fila | **Implementada** (etapa 1.11); falta o alerta de acúmulo (2.24) |
| D7 | Força bruta de senha | 3 | Por conta: 5 erros em 15 min ativam espera crescente (1→15 min); por IP: 20 tentativas em 15 min; código de login com 5 tentativas | Planejada (M2) |
| D8 | Payload montado para o validador lançar exceção, virando `500` que o SDK retenta para sempre | 1 | Valor que vem do cliente nunca é convertido em texto por coerção (`String(x)` lança em `{"toString":""}`): o `describeValue` do `@internal/schema` reporta tipo, não valor. O risco não é o `500` em si — é que `decisionForStatus` manda retentar `5xx`, então um lote que nunca vai ser aceito voltaria em loop. *Fuzzing* com fast-check (etapa 1.14) exige que o validador nunca lance | **Implementada** (etapa 1.14) |

## E — Elevation of privilege

| # | Ameaça | Fronteira | Mitigação | Status |
|---|---|---|---|---|
| E1 | `viewer` executa ação de `admin` chamando a API direto | 4 | Matriz de permissões num único arquivo (`permissions.ts`), aplicada no servidor, **com um teste por célula da tabela** | Planejada (M2) |
| E2 | Key pública usada para **ler** logs | 1 | `pk` só escreve; leitura exige `sk` com escopo `logs:read` | Planejada (M1) |
| E3 | Sessão da demo escapa do modo somente leitura | 4 | Papel de viewer garantido **no servidor**, não na interface | Planejada (M2) |
| E4 | Não-operador acessa `/operator` | 4 | `is_operator` checado no servidor, com re-autenticação por senha; operador vê uso, **nunca o conteúdo dos logs** | Planejada (M2) |
| E5 | Header repassado pelo proxy (`x-user-id`) usado como identidade | 4 | Nenhum header do proxy é confiável; **todo route handler revalida o JWT** | Planejada (M2) |
| E6 | Admin se promove a owner | 4 | Admin não pode promover a owner nem alterar/remover um owner | Planejada (M2) |
| E7 | SSRF: webhook de alerta apontado para a rede interna ou para o metadata da nuvem | 5 | Só HTTPS; bloqueio de IP privado, loopback e endereço de metadata; sem seguir redirecionamento; timeout curto | Planejada (M5) |
| E8 | Nome de arquivo de source map com `../` escrevendo fora do destino | 4 | Tamanho máximo, tipo validado e nome normalizado | Planejada (M4) |
| E9 | VM invadida por porta exposta | 2 | **Nenhuma porta de entrada, em dois níveis**: a lista de segurança da OCI tem só regra de saída, e o `docker-compose.yml` da VM não publica porta nenhuma — o ClickHouse existe só na rede dos containers, e os usuários só aceitam conexão de `172.28.0.0/16`. O túnel disca para fora; nada disca para dentro. `unattended-upgrades` com reboot automático. SSH tem chave no cloud-init e nenhuma regra na 22: o caminho é o túnel e o Access (E14) | **Código escrito** (etapas 1.17 e 1.18); vale quando a VM existir |
| E10 | Credencial do ClickHouse vazada de um app faz mais do que aquele app precisa | 2 | Um usuário por papel, com *grant* mínimo: leitura, ingestão, jobs e migrations são credenciais distintas, e só a de migrations tem DDL — e ela existe só nos *secrets* do CI | Implementada no dev e na VM (`deploy/vm/clickhouse/users.xml.tftpl`), onde os usuários são **por ambiente**: `nekolog_ingest_prod` não alcança `nekolog_dev`. `internal/clickhouse/src/grants.test.ts` falha se algum desses *grants* alargar | **Código escrito** (etapa 1.17); vale quando a VM existir |
| E11 | Credencial de ingestão lê o conteúdo dos logs | 1 | O usuário de ingestão tem `INSERT` em `logs` e `SELECT` **só nas seis colunas** que as *materialized views* leem (`project_id`, `environment_id`, `timestamp`, `received_at`, `level`, `service`); `message`, `stacktrace`, `attributes` e `user_id` ficam fora do alcance. O `received_at` entrou na etapa 1.12, com a *materialized view* de uso | Implementada no dev e na VM (`deploy/vm/clickhouse/users.xml.tftpl`), onde os usuários são **por ambiente**: `nekolog_ingest_prod` não alcança `nekolog_dev`. `internal/clickhouse/src/grants.test.ts` falha se algum desses *grants* alargar | **Código escrito** (etapa 1.17); vale quando a VM existir |
| E12 | Qualquer um dispara as tarefas agendadas pela URL pública do Worker de jobs | 5 | O app de jobs expõe **só** `GET /health`; nenhuma rota executa tarefa, e um teste falha se alguém adicionar uma. O gatilho é o Cron Trigger do Cloudflare, que não chega pela internet | Implementada (`apps/jobs/src/app.ts`) |
| E13 | Quem descobrir o hostname do túnel fala direto com o ClickHouse | 2 | O hostname é um CNAME *proxied* para o túnel, e na frente dele fica uma aplicação do Cloudflare Access: a política não-interativa exige o **service token** dos Workers, e a de operador exige um e-mail da lista. Sem um dos dois, a requisição não chega na VM. As duas políticas têm `postcondition` afirmando que o `include` é exatamente o que deveria ser — atributo aninhado escrito errado é descartado em silêncio pelo HCL, e o `validate` não reclama | **Código escrito** (etapa 1.16); vale quando a VM existir (1.17) e o `apply` for ligado |
| E14 | Um token de serviço — ou qualquer automação — abre uma sessão SSH na VM | 2 | O SSH tem túnel e aplicação Access **próprios**, separados dos do ClickHouse. A política é só de e-mail de operador: não existe token de serviço ali, e uma `postcondition` afirma que a aplicação tem exatamente essa política. O `sshd` só é alcançável pelo gateway do Docker, e o container do túnel de SSH não fica na rede do ClickHouse | **Código escrito** (etapa 1.18); vale quando a VM existir e o `apply` for ligado |
| E15 | Worker alcançado por um endereço `workers.dev`, fora de qualquer regra da zona | 5 | `workers_dev` e `preview_urls` são `false` nos três ambientes dos dois Workers. A ingestão só atende nos hostnames da zona, criados pelo OpenTofu; o Worker de jobs não atende em lugar nenhum. Os testes de `wrangler.json` de cada app falham se algum desses voltar a ser verdadeiro, ou se alguém declarar uma rota | Implementada (etapa 1.18); vale quando o deploy for ligado |

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
  Exige teste de integração de verdade.
- **Autenticação escrita à mão** assume uma classe inteira de risco que uma
  biblioteca pronta evitaria (ADR [0007](../adr/0007-autenticacao-propria.md)).
  Compensação: testes da seção 11.11 do plano, ASVS nível 2 e revisão dedicada
  antes da demo pública.
- **Uma pessoa só revisa os PRs.** O GitHub não permite aprovar o próprio PR,
  então não há revisão obrigatória até entrar um segundo mantenedor.

### Achados do Scorecard aceitos

O [OpenSSF Scorecard](../../.github/workflows/scorecard.yml) roda semanalmente e
publica no Security tab. Estes achados ficam abertos de propósito:

| Achado | Por que fica aberto |
|---|---|
| `CodeReviewID` — 0 changesets aprovados | Projeto de uma pessoa; o GitHub não deixa aprovar o próprio PR. Mesmo motivo do item acima. |
| `BranchProtectionID` — `main` não exige aprovadores | Exigir aprovador travaria o único mantenedor. O que **dá** para proteger está protegido: sem deleção, sem force-push, PR e status checks obrigatórios, assinatura exigida, ninguém com bypass. |
| `MaintainedID` — repositório com menos de 90 dias | Resolve sozinho com o tempo. |
| `FuzzingID` — sem fuzzing | Planejado: etapa 1.14 inclui fuzzing do validador de payload. |
| `CIIBestPracticesID` — sem selo OpenSSF | Não perseguido por enquanto. |
| `TokenPermissionsID` — `release.yml` | **O achado está errado.** Ele diz "topLevel 'contents' permission set to 'write'", mas o topo do arquivo é `contents: read`, tanto na `main` quanto na `dev`. O `write` é **do job**, e o `changesets/action` precisa dele para criar a branch e abrir o PR de versão, junto com `pull-requests: write`. Já é o mínimo: escopo de um job, não do workflow. Conferido em 31/10/2026. |

Desde 30/10/2026 esse SARIF sobe com `category: scorecard`. O efeito só aparece
depois que a correção chegar na `main` ou o cron semanal rodar, porque o
`scorecard.yml` dispara em `push` para `main` e no agendamento — até lá os
alertas antigos continuam na faixa padrão. Sem isso ele caía na
faixa padrão do code scanning e era reportado pelo check `CodeQL`, que então
falhava em PRs por motivos que **não são vulnerabilidade no código** — "o projeto
não tem selo OpenSSF" num PR de SDK. Um CI que fica vermelho por algo que não dá
para resolver ensina a ignorar CI vermelho, que é o oposto do que se quer. A
análise de código do CodeQL continua obrigatória para o merge; os achados de
maturidade do Scorecard, não.

## Próxima revisão

**M1**, quando ingestão, keys e ClickHouse existirem de verdade. Nessa revisão:
confirmar que cada mitigação marcada como "Planejada (M1)" foi implementada e
tem teste, e reavaliar as fronteiras 1 e 2 com o código na frente.
