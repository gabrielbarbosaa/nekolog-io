# ADR 0008 — JWT curto com refresh token rotativo

- **Status:** aceita
- **Data:** 2026-10-29
- **Plano:** seções 1 e 11.3

## Contexto

Duas forças opostas. Validar a sessão no Redis a cada request é seguro e
revogável na hora, mas gasta o orçamento do Upstash (500 mil comandos/mês)
rápido demais. Um JWT de longa duração não gasta nada, mas não há como revogar
antes de expirar.

Além disso, o requisito explícito do projeto é **detectar token roubado**, não
só expirar sessão.

## Decisão

Dois tokens, com papéis distintos:

| | Access token | Refresh token |
|---|---|---|
| Formato | JWT Ed25519 (`jose`), com `kid` | `{sid}.{segredo}`, 32 bytes aleatórios |
| Validade | 10 min | 7 dias sem uso, 30 dias no máximo |
| Cookie | `__Host-at`, `HttpOnly`, `Secure`, `SameSite=Lax` | `__Host-rt`, idem |
| No servidor | nada — validado pela assinatura | hash em `sess:{sid}` no Redis |

**Rotação com detecção de reuso:** a cada renovação o refresh token muda. Se um
token já usado reaparecer, a sessão inteira é encerrada, o evento vai para o
audit log e a pessoa recebe e-mail.

**Janela de graça de 30 s:** requests simultâneas (abas compartilham cookie)
usando o token anterior ainda recebem um access token novo, mas **não** um novo
refresh token. Sem isso, abrir duas abas derrubaria a sessão.

Um token **desconhecido** é só recusado, sem encerrar a sessão — senão qualquer
pessoa que descubra um `sid` derruba a sessão alheia de propósito.

Os papéis na organização **não** vão no token; são consultados no servidor, para
que mudança de permissão valha imediatamente.

## Consequências

- **O Redis só é tocado a cada ~10 min de uso**, na renovação, e em ações
  sensíveis. É o que faz a cota do Upstash durar.
- **Revogação tem latência de até 10 min** para ações comuns: o access token
  continua válido pela assinatura até expirar. Para ações sensíveis (criar key,
  remover membro, apagar projeto) isso não serve — elas conferem
  `EXISTS sess:{sid}` e são barradas na hora.
- **A rotação precisa ser atômica.** Comparar o token, gravar o novo e mover o
  anterior para `prev` em chamadas separadas abriria corrida sob requests
  paralelas. Por isso está num script Lua (`rotate-refresh.lua`).
- **A janela de graça é uma concessão de segurança deliberada.** Durante 30 s um
  refresh token roubado ainda gera access token. Sem ela, uso normal em múltiplas
  abas quebraria constantemente.
- **Rotação de chave do JWT exige o `kid`.** O token carrega qual chave o
  assinou, e o servidor aceita a atual e a anterior durante a troca
  (`AUTH_JWT_PREVIOUS_PUBLIC_KEY`), senão rotacionar derrubaria todo mundo.
- **Tokens nunca no `localStorage`** — só cookie `HttpOnly`, fora do alcance de
  XSS.
- **Perder o Redis derruba todas as sessões.** Aceito: não há backup de Redis;
  no pior caso todo mundo faz login de novo.

## Alternativas consideradas

- **Sessão opaca consultada no Redis a cada request.** O modelo mais simples e
  mais seguro: revogação instantânea, sem JWT. Descartada pela cota do Upstash —
  seria uma leitura por request, em todo navegação.
- **JWT de longa duração, sem refresh.** Zero consulta ao servidor. Descartada:
  sem revogação e sem nenhuma chance de detectar token roubado, que é o
  requisito central.
- **Refresh token fixo, sem rotação.** Mais simples de implementar e sem o
  problema de requests concorrentes. Descartada: um token copiado funciona até
  expirar, sem deixar rastro.
- **Papéis dentro do JWT.** Economizaria uma consulta por request. Descartada:
  rebaixar alguém levaria até 10 min para valer, o que é inaceitável para
  controle de acesso.
