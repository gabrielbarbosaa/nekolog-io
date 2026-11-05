---
title: Referência da API pública
description: Leia seus logs, o histograma deles e suas issues com uma key secreta, e registre o que você subiu.
---

Tudo que o dashboard mostra, você consegue ler por conta própria. A API serve o
próprio documento OpenAPI em `/openapi.json`, montado contra a origem de onde
você pediu, então dá para apontar um gerador ou o
[OWASP ZAP](https://www.zaproxy.org/) direto para ele.

```bash
curl https://api.nekolog.io/v1/logs?limit=20 \
  -H "Authorization: Bearer $NEKOLOG_KEY"
```

## A key decide o que você enxerga

Uma key secreta nomeia exatamente um projeto e um ambiente. O servidor tira o
escopo da key e de mais nada — não existe parâmetro `project`, e não vai
existir. Para ler outro ambiente, use a key daquele ambiente.

| | |
|---|---|
| Header | `Authorization: Bearer nekolog_sk_…` |
| Leitura | exige o escopo `logs:read` |
| Escrita | exige `logs:write`, e recusa key pública pelo prefixo |

Três coisas são recusadas antes de qualquer outra:

- **Key na URL.** `?key=…` é rejeitada com `secret_key_in_url`, mesmo em branco,
  mesmo junto de um header válido — e o hash dela nem chega a ser calculado. A
  ingestão aceita `?key=` num caminho só, porque o `navigator.sendBeacon` não
  consegue mandar header enquanto a página descarrega. Aqui nada é beacon.
- **Key pública.** Ela vai no bundle de todo navegador.
- **`env:` dentro de uma busca.** A key já nomeia um ambiente. Um filtro que
  silenciosamente não faz nada se lê como um filtro que funciona, então isso é
  um `400` e não um dar de ombros.

## Rotas

Só `GET` é roteado nas rotas de leitura, então um `POST /v1/logs` é `404` e não
erro de método.

| Rota | O que faz |
|---|---|
| `GET /health` | Se este deployment está de pé, e que versão ele é. Não precisa de key. |
| `GET /openapi.json` | Esta API, descrita. Não precisa de key. |
| `GET /v1/logs` | Busca. |
| `GET /v1/histogram` | Contagem por balde e por nível, para um gráfico. |
| `GET /v1/issues` | Erros agrupados por fingerprint. |
| `POST /v1/releases` | Registra que uma versão saiu. |
| `POST /v1/sourcemaps` | Sobe um `.map` de uma release. |

### `GET /v1/logs`

| Parâmetro | |
|---|---|
| `from`, `to` | ISO 8601 ou epoch em milissegundos. Padrão: a última hora. |
| `q` | Uma [busca](/docs/pt-br/api/search/). |
| `limit` | 1 a 1000, padrão 100. |
| `order` | `newest` (padrão) ou `oldest`. |

### `GET /v1/histogram`

Toma `from`, `to` e `q`, mais `bucket`: um de `1m`, `5m`, `15m`, `1h`, `6h` ou
`1d`. Um período que precisaria de mais de 1500 pontos é recusado — peça um
balde mais largo ou um período mais curto.

### `GET /v1/issues`

| Parâmetro | |
|---|---|
| `limit` | 1 a 200, padrão 50. |
| `status` | `open`, `resolved` ou `ignored`, repetível ou separado por vírgula. |
| `cursor` | O `nextCursor` da página anterior. |
| `since`, `until` | Limitam por quando a issue foi vista pela última vez. |

### Escrita

As duas rotas de escrita são o que um job de deploy chama, e a
[CLI](/docs/pt-br/guides/cli/) e o
[plugin de bundler](/docs/pt-br/guides/bundler-plugin/) chamam por você.

`POST /v1/releases` toma `{ version, commit?, releasedAt? }` e é
**idempotente**: a mesma versão de novo mantém o momento da primeira vez e nunca
descarta um commit já conhecido, então repetir o pipeline é de graça.

`POST /v1/sourcemaps?release=<versão>&name=<arquivo>.map` toma o mapa como
corpo. A release precisa já existir, o nome é um segmento só casando
`^[A-Za-z0-9][A-Za-z0-9._-]*\.map$`, e o corpo tem no máximo 8 MB. Subir o mesmo
nome de novo substitui sem aumentar a contagem, e uma release guarda no máximo
200 mapas.

## Paginação

**Issues paginam por cursor.** Uma issue tem id, então a leitura usa keyset em
`(last_seen_at, id)` e devolve um `nextCursor`. Passe ele de volta para a página
seguinte; `null` quer dizer que acabou.

**Logs paginam por período.** Uma linha de log não tem identidade — nada separa
duas linhas gravadas no mesmo milissegundo — então não há cursor para te dar.
Estreite o `to` para o timestamp mais antigo que você já tem e peça de novo. Isso
é uma propriedade real do dado, não um buraco na API.

## Limites

| | |
|---|---|
| Período | no máximo 31 dias por requisição |
| Histograma | no máximo 1500 pontos |
| Taxa | 120 requisições por minuto por key, com `Retry-After` no `429` |

Toda resposta leva `Cache-Control: no-store` e
`X-Content-Type-Options: nosniff`. Nada entre você e a API deveria estar
guardando seus logs.

## Erros

O corpo é sempre a mesma forma:

```json
{ "error": { "code": "invalid_query", "message": "…", "retryAfter": null } }
```

| Código | Status | |
|---|---|---|
| `invalid_key` | 401 | Sem key, key desconhecida, ou uma pública. |
| `secret_key_in_url` | 401 | A key estava na query string. |
| `insufficient_scope` | 403 | A key não pode fazer isso. |
| `invalid_query` | 400 | Um parâmetro, uma busca ou um cursor que a rota não aceita. |
| `period_too_long` | 400 | Mais de 31 dias. |
| `not_found` | 404 | Rota inexistente, ou este deployment não serve isso. |
| `unsupported_media_type` | 415 | O corpo não é o que a rota lê. |
| `payload_too_large` | 413 | Acima do limite daquela rota. |
| `rate_limited` | 429 | Volte depois de `retryAfter` segundos. |
| `upstream_unavailable` | 503 | O armazenamento de logs não respondeu. |
| `internal_error` | 500 | Outra coisa. |

**Parâmetro que a rota não tem é erro**, não algo ignorado. A mensagem nomeia o
que ela não reconheceu e o que ela aceita, para um erro de digitação nunca
parecer uma consulta que funcionou.

Um `503` responde uma frase fixa de propósito: a exceção de verdade pode citar
uma coluna ou um valor, então ela vai para o log do servidor em vez de vir para
você.
