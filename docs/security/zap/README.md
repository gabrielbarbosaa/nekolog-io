# Varredura do OWASP ZAP

Não precisa instalar nada além do Docker.

| Arquivo | O que é |
|---|---|
| `ingest-openapi.json` | A superfície da ingestão descrita para o scanner. **Não é contrato publicado** — existe para o ZAP ter o que atacar. `apps/ingest/src/scan-surface.test.ts` falha se ela deixar de bater com as rotas reais, nos dois sentidos. |
| `ingest.conf` | As regras tratadas de outro jeito na ingestão, cada uma com o motivo escrito ali. |

A API pública **não** tem arquivo aqui: ela serve o próprio `/openapi.json`, e é
dele que o ZAP parte.

## Subir os alvos

```bash
pnpm dev:infra
pnpm ch:migrate
pnpm seed add-key --environment development   # imprime a key uma vez

INGEST_EVENTS_PER_MINUTE=100000000 node --env-file=.env apps/ingest/src/serve.ts
API_REQUESTS_PER_MINUTE=100000000 node --env-file=.env apps/api/src/serve.ts
```

Os dois limites são levantados de propósito. Com os padrões, o limitador de taxa
recusa a varredura em segundos e o ZAP passa o resto do tempo medindo `429` —
que é o sistema funcionando, e não é o que se quer medir aqui.

## Rodar

```bash
KEY=nekolog_sk_…
AUTH="-config replacer.full_list(0).description=auth \
 -config replacer.full_list(0).enabled=true \
 -config replacer.full_list(0).matchtype=REQ_HEADER \
 -config replacer.full_list(0).matchstr=Authorization \
 -config replacer.full_list(0).regex=false \
 -config replacer.full_list(0).replacement=Bearer $KEY"

# a API pública, pelo OpenAPI que ela mesma serve
docker run --rm --add-host host.docker.internal:host-gateway \
  -v "$PWD/docs/security/zap:/zap/wrk:rw" -t zaproxy/zap-stable \
  zap-api-scan.py -t http://host.docker.internal:8789/openapi.json \
  -f openapi -r api.html -I -z "$AUTH"

# a ingestão, pelo arquivo deste diretório
docker run --rm --add-host host.docker.internal:host-gateway \
  -v "$PWD/docs/security/zap:/zap/wrk:rw" -t zaproxy/zap-stable \
  zap-api-scan.py -t /zap/wrk/ingest-openapi.json \
  -f openapi -c ingest.conf -r ingest.html -I -z "$AUTH"
```

No Windows, troque `$PWD` pelo caminho absoluto e use `${chave}` no lugar de
`$KEY`. O `-I` faz a varredura não falhar o comando por aviso; tire quando
quiser que ela seja um portão.

O relatório sai em `docs/security/zap/*.html` — **não commite**, está no
`.gitignore`.

## O que esperar

O resultado da última rodada está na seção "Varredura do ZAP" do
[modelo de ameaças](../threat-model.md). Hoje: zero falhas e zero avisos nas
duas superfícies, com um item ignorado e explicado.

Um **aviso novo é um achado**, não ruído. O lugar de decidir que uma regra não
se aplica é o `.conf`, com o motivo por escrito — não a memória de quem rodou.

## O que isto não cobre

- **O dashboard**, que fica no outro repositório e é onde mora o XSS.
- **`qa` e produção.** A varredura a cada promoção que o plano pede (seção 14.2)
  depende de o deploy existir. Até lá, a varredura é local e manual, contra a
  entrada Node — que é o mesmo app Hono que o Worker serve, mas sem a borda da
  Cloudflare na frente.
- **Autenticação de verdade.** O ZAP entra com uma key secreta injetada no
  header; ele não testa a troca de sessão, que é do dashboard.
