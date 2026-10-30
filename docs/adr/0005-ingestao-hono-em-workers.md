# ADR 0005 — Ingestão com Hono no Cloudflare Workers

- **Status:** aceita
- **Data:** 2026-10-29
- **Plano:** seções 1, 3, 4 e 9

## Contexto

A ingestão é o caminho quente: recebe todo lote de todo SDK de todo cliente.
Precisa ser rápida, barata, próxima do usuário e resistente a pico. E precisa
rodar em dois lugares com o mesmo código — na nuvem gratuita e no self-host com
Docker.

## Decisão

`apps/ingest` é um app **Hono**, deployado no **Cloudflare Workers** na nuvem e
rodando em **Node** no self-host. O Hono roda nos dois runtimes sem adaptação.

A ingestão segue o princípio de **"ingestão burra, processamento fora"**: ela só
valida o lote e grava. Fingerprint de erros, resolução de source map e avaliação
de alertas rodam em `apps/jobs`, nunca aqui.

Ela **não depende do Postgres nem do Redis**. A configuração das keys fica
copiada no Workers KV.

Resposta imediata: valida, responde `202`, grava em segundo plano com
`waitUntil()`. Se o insert no ClickHouse falhar, o lote vai para o R2 (`spool/`)
e os jobs reenviam depois, usando o `batchId` como token de deduplicação.

## Consequências

- **10 ms de CPU por request é o teto real.** Isso proíbe validação pesada — daí
  o Valibot em vez de Zod (ADR [0012](0012-escolha-de-bibliotecas.md)) e nada de
  parsing de stack trace ou regex complexa no caminho quente.
- **Sem Postgres na ingestão, as keys precisam ser sincronizadas.** Criar ou
  revogar uma key exige escrever no KV a partir do dashboard, e a propagação
  leva até ~60 s. Uma key revogada continua funcionando nesse intervalo — custo
  aceito, documentado.
- **Rate limit sem Redis fica aproximado.** O contador vive na memória da
  instância do Worker, e há muitas instâncias. Serve para conter rajada, não
  para impor um limite exato. A cota diária, essa sim precisa ser exata, é
  calculada pelos jobs a partir da `logs_per_minute` e gravada como bloqueio no
  KV.
- **`202` não significa "gravado".** O cliente recebe aceitação antes do insert
  acontecer. Em troca, a contingência no R2 garante que um ClickHouse fora do ar
  não perca dados — mas um bug no caminho do `waitUntil` perderia silenciosamente.
  Isso precisa de teste de integração de verdade.
- **100 mil requests/dia e 1.000/min** são o limite do plano gratuito. Com
  envio em lote pelo SDK (não um request por log), isso comporta um volume
  razoável.

## Alternativas consideradas

- **Next.js API routes na Vercel, junto do dashboard.** Uma peça a menos.
  Descartada: a Vercel Hobby é só para uso não comercial, e acoplaria a
  ingestão ao ciclo de deploy do dashboard — que depois virou um repositório
  privado separado (ADR [0002](0002-open-core-com-dashboard-fechado.md)),
  o que teria tornado isso um problema sério.
- **Express ou Fastify em Node na VM Oracle.** Simples e sem limite de CPU.
  Descartada: a VM é o ponto único de falha mais frágil da arquitetura (é ela
  que roda o ClickHouse); colocar a ingestão lá significa que perder a VM perde
  tudo, inclusive a capacidade de receber logs e guardá-los na contingência.
- **Cloudflare Queues entre a ingestão e o ClickHouse.** Desacoplaria o insert.
  Descartada como padrão: o `async_insert` do ClickHouse já agrupa no servidor,
  e o plano gratuito de Queues dá 10 mil operações/dia — estouraria antes do
  limite de requests do Worker. Fica como adaptador opcional.
