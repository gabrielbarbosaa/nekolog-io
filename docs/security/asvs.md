# OWASP ASVS nível 2 — o que este repositório fecha

- **Data:** 04/11/2026 (etapa 6.5)
- **Escopo:** só o que está neste repositório. Autenticação, sessão, gestão de
  usuário e controle de acesso por papel são do `nekolog-dashboard` e **não**
  são avaliados aqui.

O plano (seção 14) nomeia o ASVS nível 2 como checklist para autenticação,
sessão, controle de acesso, validação de entrada e configuração. Das cinco, as
duas primeiras e a terceira são do dashboard. Esta página cobre as que são
daqui, mais o que a plataforma faz de controle de acesso por **key**.

Cada linha aponta para onde a afirmação é verificada. Linha sem teste é linha
que não está fechada, e está marcada como tal.

## V1 — Arquitetura

| Item | Como está | Onde |
|---|---|---|
| Fronteiras de confiança documentadas e revisadas | Sim, STRIDE por fronteira, revisado a cada marco | [threat-model.md](threat-model.md) |
| Componentes com segredo identificados | Sim: keys, `ENCRYPTION_KEY`, credenciais do ClickHouse, tokens de deploy | threat-model, "O que estamos protegendo" |
| Comportamento vendor-specific atrás de interface | Sim: `KeyStore`, `BlobStore`, `RateLimiter`, `LogStore`, `SqlRunner`, `Mailer` | `packages/adapters` |

## V5 — Validação, sanitização e codificação

| Item | Como está | Onde |
|---|---|---|
| Toda entrada validada por esquema, não por confiança | Sim, Valibot sobre a especificação 1; campo desconhecido é ignorado, nunca gravado | `internal/schema/src/v1` |
| O validador nunca lança com entrada hostil | Sim, *fuzzing* com fast-check exige isso; valor do cliente nunca vira texto por coerção | `internal/schema/src/v1/fuzz.test.ts`, ameaça D8 |
| SQL sempre parametrizado | Sim, inclusive o **nome do atributo** na linguagem de busca | `packages/clickhouse/src/search`, ameaça T1 |
| Limites de tamanho impostos e testados | Sim: 512 KB declarado, lido e descomprimido; 500 eventos; 16 KB por mensagem | `apps/ingest/src/body.ts`, ameaça D3 |
| Parâmetro desconhecido é recusado, não ignorado | Sim, desde a 6.5, nomeando os que a rota tem | `apps/api/src/period.ts`, ameaça I12 |
| Saída codificada para o contexto de destino | Parcial: a injeção de fórmula em CSV está fechada e testada; a renderização em HTML é do dashboard | ameaça T3 |
| Entrada não confiável nunca interpretada como código | Sim: CSP sem `unsafe-inline`/`unsafe-eval` nos sites; `nosniff` nas APIs | ameaças T8, I13 |

## V7 — Tratamento de erro e log

| Item | Como está | Onde |
|---|---|---|
| Mensagem de erro não revela estrutura interna | Sim na API: uma falha de upstream responde uma frase fixa, e a exceção real — que pode citar coluna ou valor — vai para o log | `apps/api/src/app.ts` |
| Segredo nunca aparece em log ou em mensagem | Sim: o CLI de deploy não imprime valor em nenhuma mensagem, nem na de erro de parse; a credencial do S3 é tirada do texto de erro do ClickHouse | ameaça I11, `export` da etapa 4.12 |
| Falha de medição não é tratada como "está tudo bem" | Sim, regra geral: cota, capacidade e avaliação de alerta todas **não resolvem** quando a medição falha | ameaças D1, D5, `alert-evaluate` |

## V8 — Proteção de dado

| Item | Como está | Onde |
|---|---|---|
| Dado sensível removido antes de sair do processo do cliente | Sim, no SDK, **depois** do `beforeSend` | ADR 0014, ameaça I2 |
| Remoção também no servidor, com lista fechada de padrões | Sim, por ambiente; tenant não escreve regex; regra ilegível aplica **tudo** | ameaça I2, etapa 5.5 |
| IP do usuário final nunca armazenado | Sim, só o país; teste manda `CF-Connecting-IP` e confere que não entra | ameaça I6 |
| Retenção imposta pelo servidor, não pelo cliente | Sim, o `timestamp` é limitado antes da gravação | ameaça T10 |
| Resposta com dado de tenant não é armazenável | Sim, `Cache-Control: no-store` | ameaça I13 |
| Segredo em repouso cifrado com AEAD e dado adicional | Sim, AES-256-GCM com o id do canal como AAD; *check constraint* recusa claro | ameaça I8 |
| Existe caminho de rotação para a chave do banco | Sim, `resealChannelSecrets`, com *dry run*, idempotente e escrita condicional | etapa 5.10 |

## V9 — Comunicação

| Item | Como está | Onde |
|---|---|---|
| TLS obrigatório na nuvem | Sim: hostname da zona pela Cloudflare; `workers_dev` falso nos três ambientes | ameaça E15 |
| Cliente recusa mandar credencial em claro | Sim, a CLI e o plugin recusam `http://` para fora desta máquina | etapas 4.7 e 4.9 |
| HSTS | Sim, nos sites e agora também nas APIs | `@internal/security-headers` |
| Saída para endereço de terceiro protegida contra SSRF | Sim, lista de recusa, `redirect: 'manual'`, deadline, e **checagem de novo no envio** | ameaça E7 |

## V10 — Código malicioso e cadeia de suprimentos

| Item | Como está | Onde |
|---|---|---|
| Dependência com vulnerabilidade conhecida barra o PR | Sim, `pnpm audit` no workflow `Supply chain` | ameaça T4 |
| Licença incompatível com produto proprietário barra o PR | Sim, `pnpm run licences:check` no mesmo workflow | ameaça T4 |
| Sem script de instalação por padrão | Sim, `allowBuilds` explícito no pnpm | ameaça T4 |
| Janela mínima antes de aceitar versão nova | Sim, `minimumReleaseAge` de 3 dias | ameaça T4 |
| Action fixada por SHA | Sim | ameaça T5 |
| Publicação sem token guardado | Sim — trusted publishing (OIDC), nenhum token no repositório | ameaça S7 |
| Inventário do que cada pacote traz | Sim — um SBOM CycloneDX por pacote, anexado à Release dele | ameaça S9 |

## V12 — Arquivo

| Item | Como está | Onde |
|---|---|---|
| Nome de arquivo enviado nunca vira caminho | Sim, segmento único por *allowlist*, id em vez de versão | ameaça T12 |
| Tipo conferido, não deduzido da extensão | Sim, a cabeça do arquivo precisa abrir objeto JSON e nomear `mappings`/`sections` | etapa 4.8 |
| Teto de tamanho e de quantidade | Sim, 8 MB por mapa e 200 por release | etapa 4.8 |
| Arquivo enviado nunca é servido de volta | Sim, não existe rota de leitura de source map nesta API | ameaça I5 |

## V13 — API e serviço

| Item | Como está | Onde |
|---|---|---|
| Autenticação em toda rota que não seja `/health` | Sim | `apps/api/src/app.ts` |
| Credencial nunca na URL | Sim, `?key=` é recusado antes de qualquer consulta — nem o hash é calculado | ameaça I3 |
| Escopo vem do servidor, nunca do pedido | Sim, do `principal` da key | ameaças T11, I12 |
| Método não previsto não vira erro de método | Sim, só `GET` é roteado nas rotas de leitura, então `POST` é 404 | etapa 5.9 |
| Limite de taxa por chamador | Sim, por `projeto:ambiente`, com `Retry-After` | etapas 1.12 e 5.9 |
| Esquema publicado e igual ao que o código aceita | Sim, e há teste prendendo os parâmetros de cada rota ao OpenAPI | `apps/api/src/params.test.ts` |

## V14 — Configuração

| Item | Como está | Onde |
|---|---|---|
| Segredo fora do repositório | Sim; toda senha do compose vem do `.env`, e `grants.test.ts` falha se um `<password>` literal aparecer no arquivo de usuários do ClickHouse | ameaça I11 |
| Cabeçalhos de segurança de uma fonte só | Sim, `@internal/security-headers`, sites e APIs | ameaças T8, T9, I13 |
| Serviço não expõe porta que não precisa | Sim no compose: só o Caddy publica 80 e 443; o hardening do host é o item B2, ainda por fazer | ameaça E9, lista de aceitas |
| Credencial de banco com *grant* mínimo, por papel e por ambiente | Sim, com teste que falha se algum alargar | ameaças E10, E11 |
| Nenhuma rota dispara trabalho agendado | Sim, e um teste falha se alguém adicionar uma | ameaça E12 |
| Varredura automatizada de vulnerabilidade | Parcial, e menos do que era: `pnpm audit` em todo PR cobre dependência, o ZAP é manual, e **não há mais análise estática do código** desde que o CodeQL saiu | [zap/README.md](zap/README.md) |

## O que fica em aberto

1. **Padrões próprios de secret scanning** para `nekolog_sk_`/`nekolog_pk_` no
   GitHub (ameaça I9).
2. **O *trusted publisher* de cada pacote no npmjs.com.** O lado do
   repositório saiu na etapa 6.7 — o workflow pede o token OIDC e não carrega
   credencial nenhuma — mas o lado do npm é uma configuração por pacote, que
   só existe depois da conta (ameaça S7).
3. **Varredura do ZAP a cada promoção**, que depende de `qa` existir.
4. **Uma pessoa só revisa os PRs.** Não dá para fechar sozinho.
5. **Tudo de autenticação, sessão e controle de acesso por papel**, que é do
   outro repositório e tem revisão dedicada própria antes da demo pública.
