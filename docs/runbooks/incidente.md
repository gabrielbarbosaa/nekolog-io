# Runbook — Incidente

> Ponto de entrada para qualquer coisa fora do ar, lenta ou estranha.
> Leia o [aviso sobre o estado dos runbooks](README.md#estado-destes-runbooks).

## 1. Estabilizar antes de entender

A ordem importa. Primeiro reduzir o dano, depois descobrir a causa.

1. **Confirme que é real.** Veja o monitor externo (Better Stack) e tente você
   mesmo: `app.nekolog.io`, `ingest.nekolog.io/health`. Alerta sozinho pode ser
   falso positivo do próprio monitor.
2. **Delimite.** Qual peça caiu? Use `/health` de cada app — ele reporta a
   versão e o estado de ClickHouse, Postgres e Redis.
3. **Anote a hora de início** e o que você observou. Você vai precisar disso
   depois e não vai lembrar.

## 2. Qual peça caiu

| Sintoma | Peça provável | Vá para |
|---|---|---|
| Dashboard fora do ar, ingestão ok | Vercel ou Neon | [§3.1](#31-dashboard-fora-do-ar) |
| Ingestão retornando erro, dashboard ok | Worker ou ClickHouse | [§3.2](#32-ingestão-falhando) |
| Tudo ok mas sem logs novos aparecendo | ClickHouse ou contingência | [§3.3](#33-logs-não-aparecem) |
| Ninguém consegue entrar | Redis (Upstash) ou e-mail | [§3.4](#34-ninguém-consegue-entrar) |
| Alertas pararam de disparar | Worker de jobs | [§3.5](#35-jobs-parados) |
| Suspeita de acesso indevido | — | **Pare e vá para [§5](#5-se-for-incidente-de-segurança)** |

## 3. Diagnóstico por peça

### 3.1 Dashboard fora do ar

1. Status da Vercel e do deploy mais recente. Se foi um deploy ruim, **reverta
   pela Vercel** — é mais rápido que corrigir e esperar o build.
2. Neon: o banco hiberna depois de 5 min parado; cold start é normal, **fora do
   ar não é**. Confira a cota de CU-h do mês.
3. Upstash: cota de 500 mil comandos/mês. Estourada, o login para.

### 3.2 Ingestão falhando

1. Qual código de erro os clientes recebem? `429` é cota, `401`/`403` é key,
   `5xx` é a plataforma.
2. Cota do Worker: 100 mil req/dia, 1.000/min. Se estourou, **a plataforma está
   recusando tráfego legítimo** — avalie se é abuso de um cliente só (bloqueie
   aquela organização) ou crescimento real.
3. ClickHouse inalcançável: veja [§3.3](#33-logs-não-aparecem). A ingestão
   **deve** continuar respondendo `202` e mandando para a contingência no R2 —
   se ela estiver retornando `5xx` com o ClickHouse fora, isso é um bug, não só
   um incidente.

### 3.3 Logs não aparecem

1. A VM Oracle está de pé? Console da Oracle.
2. O Tunnel está conectado? Painel do Cloudflare Zero Trust.
3. O container do ClickHouse está rodando? SSH pelo Cloudflare Access,
   `docker compose ps`.
4. **Disco cheio** é a causa mais provável de um ClickHouse que para de aceitar
   insert. `df -h` na VM. Se estiver cheio: confirme que o TTL está removendo
   partições antigas (`SELECT * FROM system.parts` «conferir query»), e
   considere reduzir `retention_days` dos ambientes.
5. Confira quanto acumulou na contingência: `spool/` no R2. Isso diz há quanto
   tempo o problema existe e quanto os jobs vão precisar reenviar.

### 3.4 Ninguém consegue entrar

1. Redis (Upstash) fora ou com cota estourada: códigos e sessões não funcionam.
   **Todas as sessões caem** — é aceito por desenho, não há backup de Redis.
2. Resend fora ou cota de 100 e-mails/dia estourada: ninguém recebe o código de
   login. Confira se não é bot consumindo a cota (deveria estar barrado por
   convite + Turnstile; se não estava, é um achado).

### 3.5 Jobs parados

O monitor externo recebe um heartbeat a cada execução — se parou, o alerta vem
de lá. Confira o cron no painel do Cloudflare e os logs do Worker de jobs. Com
os jobs parados: alertas não disparam, cotas não são aplicadas e a contingência
não é reenviada. **Nada quebra visivelmente**, e é justamente por isso que o
heartbeat existe.

## 4. Comunicação

- Incidente que afeta usuários: atualize a página de status pública do Better
  Stack. Mesmo "estamos investigando" é melhor que silêncio.
- Dado de terceiro exposto: há obrigação de notificação sob a LGPD. Vá para
  [§5](#5-se-for-incidente-de-segurança).

## 5. Se for incidente de segurança

**Não apague nada.** Log, sessão e registro de acesso são a evidência.

1. **Contenha**: revogue o que for necessário (key, sessão, token). Runbooks
   específicos: [vazamento de key](vazamento-de-key.md),
   [rotação de segredos](rotacao-de-segredos.md).
2. **Preserve**: exporte o `audit_log` do período e os logs relevantes antes que
   a retenção os apague.
3. **Avalie o alcance**: que dado pôde ser acessado, de quem, por quanto tempo.
4. **Notifique** quem foi afetado. Sob a LGPD, vazamento de dado pessoal tem
   dever de comunicação ao titular e à ANPD.
5. Se veio por reporte externo, responda pelo canal do
   [SECURITY.md](../../SECURITY.md) e combine a divulgação com quem reportou.

## 6. Depois

1. Escreva o que aconteceu: linha do tempo, causa, o que atrasou a resolução.
2. **Atualize este runbook** com o que estava errado ou faltando.
3. Se a causa revelou uma ameaça não prevista, adicione ao
   [modelo de ameaças](../security/threat-model.md).
4. Vire as correções em etapas do [ETAPAS.md](../ETAPAS.md), não em boas
   intenções.
