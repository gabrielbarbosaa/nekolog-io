# @internal/spool

O formato da contingência: como um lote que o ClickHouse recusou é guardado no
R2 e como os jobs leem de volta. É o contrato entre `apps/ingest` (que grava) e
`apps/jobs` (que reenvia) — por isso vive aqui, e não dentro de um dos dois.

Pacote interno: não vai para o npm. Sem dependências.

## O nome do arquivo

```
spool/0001793880000000-01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10.json
      └─ ms desde a época, 13 dígitos ─┘ └────── batchId ──────┘
```

O carimbo de tempo é **preenchido com zeros à esquerda**, e isso não é estética:
a varredura dos jobs pede ao R2 os primeiros N objetos do prefixo, e o R2 (como
o S3) devolve em ordem de texto. Com largura fixa, ordem de texto é ordem
cronológica, então pedir os primeiros N é pedir os mais antigos — sem listar o
bucket inteiro todo minuto.

O `batchId` vem do SDK, ou seja, **é entrada não confiável**, e aqui ele vira
nome de arquivo. `spoolKey` recusa qualquer coisa que não seja um UUID em
minúsculas com hífens; `parseSpoolKey` recusa de novo na leitura. O
`@internal/schema` já exige UUID v7 na ingestão — esta checagem é a segunda
tranca, para o dia em que alguém chamar isto de outro lugar.

`quarantineKeyFor` move o arquivo de `spool/` para `quarantine/` mantendo o
nome, e recusa qualquer chave que não comece em `spool/` — assim a quarentena
nunca consegue escrever fora dela.

## O conteúdo

```json
{
  "spoolVersion": 1,
  "spooledAt": 1793880000000,
  "batchId": "…",
  "projectId": "p_1",
  "environmentId": "e_1",
  "deduplicationToken": "e_1:…",
  "rows": [ { "project_id": "p_1", "message": "…" } ]
}
```

As `rows` já são as linhas prontas da tabela `logs` — a ingestão faz o
mapeamento uma vez só, antes de tentar gravar, e o reenvio não repete esse
trabalho nem corre o risco de mapear diferente meses depois.

`decodeSpoolEnvelope` é **estrito de propósito**: versão desconhecida, JSON
inválido, bytes que não são UTF-8, `rows` vazio, campo faltando — tudo vira
`SpoolFormatError`. Um arquivo que não dá para ler com segurança vai para a
quarentena em vez de ser adivinhado.

## O token de deduplicação

```ts
deduplicationTokenFor('e_1', batchId) // "e_1:01933b9e-…"
```

É ele que torna o reenvio seguro: se o insert funcionou mas o `delete` do
arquivo falhou, o próximo minuto reenvia o mesmo lote e o ClickHouse grava uma
vez só.

**Por que o ambiente entra no token.** O `batchId` é escolhido pelo cliente, e a
deduplicação do ClickHouse é por partição da tabela — que é compartilhada por
todos os projetos. Sem o prefixo, dois ambientes diferentes usando o mesmo
`batchId` na mesma partição fariam o segundo lote desaparecer em silêncio.
Adivinhar um UUID v7 alheio é difícil, mas o prefixo custa nada e tira a
possibilidade da mesa.

Vale saber o limite: `non_replicated_deduplication_window = 1000` guarda os mil
últimos blocos por partição. Um reenvio tão atrasado que mil inserts já
passaram naquela partição pode duplicar. Na prática não acontece, porque durante
a queda não há insert nenhum e o reenvio vem no minuto seguinte à volta.
