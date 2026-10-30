# Runbook — Vazamento de key

> Leia o [aviso sobre o estado dos runbooks](README.md#estado-destes-runbooks).

Duas situações muito diferentes com o mesmo nome. Identifique qual é antes de
agir.

| | Key de cliente (`nekolog_sk_…`) | Credencial da plataforma |
|---|---|---|
| **Exemplo** | `sk` commitada num repositório público | `CLICKHOUSE_INSERT_PASSWORD`, `CF_KV_API_TOKEN`, token de deploy |
| **Alcance** | Um ambiente de um projeto | Toda a plataforma |
| **Vá para** | [§1](#1-key-de-cliente) | [§2](#2-credencial-da-plataforma) |

---

## 1. Key de cliente

### 1.1 Conter (minutos, não horas)

1. **Revogue a key** pelo dashboard. Isso remove a entrada do KV.
2. **A revogação leva até ~60 s** para valer em todo lugar, por causa do cache
   de 60 s no Worker. Não é instantâneo — conte com essa janela.
3. **Crie uma key nova** para o mesmo ambiente e entregue a quem precisa, antes
   que a revogação quebre a aplicação do cliente.

### 1.2 Avaliar o alcance

O que a key permitia depende do tipo e do escopo:

- **`pk` (pública):** só escreve. O dano possível é log falso e consumo de
  cota. Confira o volume do ambiente no período e se a lista de origens
  permitidas estava configurada — se estava, o alcance real foi bem menor.
- **`sk` com `logs:write`:** idem, sem a proteção de origem.
- **`sk` com `logs:read`:** **pôde ler os logs daquele ambiente.** Esse é o caso
  grave. Trate como vazamento de dado: siga o
  [runbook de incidente, §5](incidente.md#5-se-for-incidente-de-segurança).

### 1.3 Verificar o uso

1. "Último uso" da key no dashboard indica se foi usada depois do vazamento.
2. Procure gravações anômalas no ambiente: volume fora do padrão, `service`
   desconhecido, país inesperado.
3. Registre tudo no `audit_log`.

### 1.4 Se a key foi commitada num repositório público

Revogar **não basta** — a key continua no histórico do Git e em caches de
terceiros. A key revogada é inútil, mas confirme que foi mesmo revogada antes de
considerar encerrado. Reescrever o histórico do repositório do cliente é decisão
dele, não nossa.

---

## 2. Credencial da plataforma

**Assuma comprometimento total do que aquela credencial alcança.** Não tente
estimar se "provavelmente ninguém viu".

### 2.1 Conter

1. **Revogue no provedor primeiro, rode a rotação depois.** Uma credencial
   revogada que ainda não foi substituída causa indisponibilidade; uma
   credencial comprometida que ainda funciona causa dano. Indisponibilidade é
   preferível.
2. Siga o [runbook de rotação de segredos](rotacao-de-segredos.md) para o
   segredo específico.

### 2.2 Por credencial

| Credencial | Alcance do comprometimento | Urgência |
|---|---|---|
| `AUTH_JWT_PRIVATE_KEY` | **Forjar sessão de qualquer usuário.** Crítico | Imediata |
| `AUTH_OTP_SECRET` | Prever/validar código de login | Imediata |
| `ENCRYPTION_KEY` | Decifrar segredos de webhook e tokens guardados no banco | Imediata |
| `DATABASE_URL` | Todos os metadados: usuários, orgs, keys (hashes), alertas | Imediata |
| `CLICKHOUSE_READ_PASSWORD` | Ler **todos os logs de todos os clientes** | Imediata |
| `CLICKHOUSE_INSERT_PASSWORD` | Gravar logs falsos | Alta |
| `CF_KV_API_TOKEN` | Reescrever config de keys → redirecionar logs entre projetos | Alta |
| `R2_SECRET_ACCESS_KEY` | Exportações e source maps | Alta |
| `CLOUDFLARE_API_TOKEN` / `VERCEL_API_TOKEN` | **Deployar código arbitrário.** Crítico | Imediata |
| `TOFU_STATE_PASSPHRASE` | Decifrar o estado do OpenTofu → **todos os segredos de infraestrutura de uma vez** | Imediata |
| `RESEND_API_KEY` | Enviar e-mail como `nekolog.io` (phishing) | Alta |
| `BACKUP_AGE_RECIPIENT` | Chave **pública** — vazamento é inofensivo | Nenhuma |

### 2.3 Caso especial: credencial de publicação no npm

Não existe token de npm para vazar: a publicação usa trusted publishing (OIDC),
sem segredo guardado. **Se um pacote `@nekolog-io/*` for publicado sem ser pelo
CI**, isso é comprometimento da conta do npm ou do GitHub, não de uma
credencial:

1. Deprecate a versão maliciosa no npm imediatamente (`npm deprecate`) — não
   confie em `unpublish`, que tem janela de 72 h e pode já não ser possível.
2. Publique uma versão corrigida.
3. Avise pelo GitHub (Security Advisory) — o pacote roda **dentro da aplicação
   de terceiros**, é o maior alcance possível de dano.
4. Revise os logs de acesso do npm e do GitHub.

### 2.4 Depois

1. Confirme que a credencial antiga **realmente** não funciona mais.
2. Investigue como vazou. Se foi por um caminho que o secret scanning deveria
   ter pegado, o achado é esse — conserte o detector, não só o segredo.
3. Registre no `audit_log` e no [modelo de ameaças](../security/threat-model.md)
   se revelou uma ameaça não prevista.
