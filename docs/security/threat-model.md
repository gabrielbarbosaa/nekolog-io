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
| S1 | Alguém usa uma key roubada para gravar logs falsos num projeto | 1 | Hash SHA-256 da key no servidor; origens permitidas por ambiente; revogação pelo dashboard | Planejada (M1) |
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
| I2 | Cliente envia segredo dentro do log sem perceber | 1 | Remoção por padrão no SDK (`password`, `token`, `authorization`, `cpf`, cartão) **antes de sair do processo**, mais regras no servidor por ambiente | Planejada (M1/M5) |
| I3 | Key secreta na URL aparece em log de proxy, histórico e referer | 1 | `sk` só em header; `sk` na URL é recusada com erro próprio (`secret_key_in_url`) | Planejada (M1) |
| I4 | Arquivo de exportação no R2 acessível por quem tiver o link | 4 | E-mail leva ao dashboard, não ao arquivo; download exige login e permissão no ambiente; ciclo de vida apaga em 7 dias | Planejada (M4) |
| I5 | Source map expõe o código original do cliente | 4 | Upload autenticado; resolução só na exibição da issue, para quem tem permissão | Planejada (M4) |
| I6 | IP do usuário final guardado junto do log (LGPD) | 1 | **IP nunca é gravado** — só o país, resolvido na ingestão | Planejada (M1) |
| I7 | Mensagem de erro revelando estrutura interna ou existência de conta | 3 | Mensagens genéricas ("e-mail ou senha inválidos"); verificação argon2 de mentira quando o e-mail não existe, para o tempo de resposta não denunciar | Planejada (M2) |
| I8 | Segredo de webhook ou token do Slack em claro no banco | 4 | AES-256-GCM com `ENCRYPTION_KEY` fora do banco | Planejada (M5) |
| I9 | Segredo commitado por engano | 6 | Secret scanning com push protection e padrões próprios para `nekolog_sk_`/`nekolog_pk_`; `.env` fora do Git | **Parcial** — scanning ativo; padrões próprios pendentes |

## D — Denial of service

| # | Ameaça | Fronteira | Mitigação | Status |
|---|---|---|---|---|
| D1 | Volume de logs estoura a cota gratuita e derruba a plataforma para todos | 1 | Cota diária por organização, calculada pelos jobs a partir da `logs_per_minute`, com bloqueio gravado no KV; rate limit em memória no Worker para rajada | Planejada (M1) |
| D2 | Bots criando conta esgotam os 100 e-mails/dia da Resend | 3 | Instância **só por convite**; Turnstile no cadastro, login e recuperação; espera de 60 s e máximo de 5 envios por hora por conta | Planejada (M2) |
| D3 | Lote gigante ou bomba de descompressão gzip | 1 | Limite de 512 KB **depois de descomprimido**; máximo de 500 eventos; `413` com código estável | Planejada (M1) |
| D4 | Query de busca cara travando o ClickHouse | 4 | Limites na linguagem: 1.000 caracteres, 20 condições, 5 níveis de parênteses | Planejada (M4) |
| D5 | Disco da VM enche e o ClickHouse para | 2 | TTL por linha (`retention_days`); alerta de disco acima de 80%; monitor externo | Planejada (M2) |
| D6 | ClickHouse fora do ar faz perder logs recebidos | 2 | Contingência no R2 (`spool/`) e reenvio pelos jobs, com `batchId` como token de deduplicação | Planejada (M1) |
| D7 | Força bruta de senha | 3 | Por conta: 5 erros em 15 min ativam espera crescente (1→15 min); por IP: 20 tentativas em 15 min; código de login com 5 tentativas | Planejada (M2) |

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
| E9 | VM invadida por porta exposta | 2 | **Nenhuma porta de entrada**: tudo pelo Cloudflare Tunnel, lista de segurança da Oracle nega entrada; SSH só por chave, via Cloudflare Access; `unattended-upgrades` | Planejada (M1) |
| E10 | Credencial do ClickHouse vazada de um app faz mais do que aquele app precisa | 2 | Um usuário por papel, com *grant* mínimo: leitura, ingestão, jobs e migrations são credenciais distintas, e só a de migrations tem DDL — e ela existe só nos *secrets* do CI | Implementada no dev (`deploy/clickhouse-users.dev.xml`); falta na VM (M1) |
| E11 | Credencial de ingestão lê o conteúdo dos logs | 1 | O usuário de ingestão tem `INSERT` em `logs` e `SELECT` **só nas cinco colunas** que a *materialized view* lê (`project_id`, `environment_id`, `timestamp`, `level`, `service`); `message`, `stacktrace`, `attributes` e `user_id` ficam fora do alcance | Implementada no dev (`deploy/clickhouse-users.dev.xml`); falta na VM (M1) |

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

## Próxima revisão

**M1**, quando ingestão, keys e ClickHouse existirem de verdade. Nessa revisão:
confirmar que cada mitigação marcada como "Planejada (M1)" foi implementada e
tem teste, e reavaliar as fronteiras 1 e 2 com o código na frente.
