# Fechar e cobrar — o que precisa acontecer

> Decidido por você em 05/11/2026: tudo numa VPS Hostinger (a mais barata, no
> começo), produto **privado e pago**, o GitHub **continua público por
> enquanto**, e **nada pode custar nada para rodar localmente**. A VPS é
> comprada no dia 10.

## A decisão que trava todas as outras

"Público" e "privado" não são os lados certos da moeda. **O que dá o produto
não é a visibilidade do repositório, é a licença MIT.** Um repositório pode
ficar à vista e ainda assim ninguém poder subir uma cópia e cobrar por ela —
é exatamente para isso que existem as licenças *source-available*.

Então manter o GitHub público e querer cobrar não é contraditório. Manter o
GitHub público **sob MIT** e querer cobrar é.

E isso tem relógio: **cada commit que entra sob MIT fica MIT para sempre.** Os
225 commits que já existem não voltam atrás — mas você é o autor de todos,
sem co-autor, então daqui para frente você escolhe. Quanto mais tarde a
decisão, mais trabalho é doado de forma irreversível.

**Consequência imediata: o passo do npm está bloqueado.** Publicar os 17
pacotes sob MIT é a única coisa nesta lista que não se desfaz — a janela de
despublicação do npm são 72 horas e com condições. Foi sorte termos parado
antes.

### As quatro licenças que fazem sentido

| Licença | O que proíbe | Vira aberta depois? | Quem usa |
|---|---|---|---|
| **FSL** | competir com você | sim, em 2 anos | Sentry |
| Elastic 2.0 | oferecer como serviço gerenciado | nunca | Elastic |
| BSL 1.1 | uso em produção, com exceções que você define | sim, em até 4 anos | MariaDB, Terraform |
| PolyForm Shield | competir com você | nunca | — |

**Eu recomendaria a FSL.** É de uma página, foi escrita exatamente para este
caso, mantém o código à vista (que é o seu portfólio) e a conversão em 2 anos
é um sinal de boa-fé que custa pouco — ninguém vai esperar dois anos para
competir com uma versão velha.

### E a licença não é uma só

Os SDKs **têm que continuar MIT**. Eles rodam dentro da aplicação do cliente,
e o jurídico de qualquer empresa barra uma dependência com licença restritiva
no próprio bundle. É o que o Sentry faz: SDK permissivo, servidor fechado.

| Grupo | Pacotes | Licença |
|---|---|---|
| SDKs | `core`, `browser`, `node`, `react`, `next`, `express`, `fastify`, `hono`, `nestjs`, `pino`, `winston`, `cli`, `bundler-plugin` | **MIT** |
| Compartilhados | `adapters`, `clickhouse`, `config`, `db` | FSL, ou sair do npm |
| Apps | `ingest`, `api`, `jobs`, `web`, `docs` | FSL |

Os compartilhados são o caso chato: o ADR 0016 os publicou **porque o
dashboard fechado precisa instalá-los**. Ou ficam no npm sob FSL, ou saem do
npm e o dashboard passa a consumi-los por git. As duas funcionam; a segunda é
mais trabalho e protege mais.

---

## Tabela A — Licença e texto

Esforço: **P** até um dia, **M** dois a cinco dias, **G** mais que uma semana.

| # | O que fazer | Estado | Esforço |
|---|---|---|---|
| A1 | Escolher a licença | **feito** — proprietária, todos os direitos reservados | P |
| A2 | Decidir a licença por grupo de pacote | **feito** — uma só, inclusive nos SDKs, com a concessão estreita da seção 3 | P |
| A3 | Trocar `LICENSE` e guardar o MIT histórico | **feito** — `966f509` é o commit de corte | P |
| A4 | Campo `license` nos `package.json` | **feito** — 18 manifests | P |
| A5 | `README`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY` | **feito, e menor que o previsto** — as duas traduções do README e os dois arquivos de comunidade foram **removidos**, não reescritos | M |
| A6 | A documentação, **nos três idiomas** | **feito** — as três páginas de self-host foram removidas, 54 blocos de "ainda não está no npm" saíram, e a introdução passou a dizer o que o cliente recebe | M |
| A7 | A landing (`apps/web`, 3 locales) e o post de lançamento | **feito** — a seção "o que é aberto" virou "o que roda onde", e o `docs/launch/` foi removido | M |
| A8 | Consertar `readme.test.ts` e `claims.test.ts` | **feito** — os dois, mais um guarda novo em `apps/docs` | P |
| A9 | ADR superando a [0002](adr/0002-open-core-com-dashboard-fechado.md) | **feito** — [0017](adr/0017-licenca-proprietaria-e-repositorio-privado.md) | P |
| A10 | CLA, ou fechar PR de terceiro | **resolvido por consequência** — repositório privado, não há PR de terceiro | P |
| A11 | Regerar os SBOM | nada a fazer: o CycloneDX lê a licença do manifest | P |

O `readme.test.ts` deixou de conferir as frases antigas e passou a guardar as
novas: os arquivos removidos **não podem voltar**, nada na raiz pode chamar o
projeto de MIT, open source ou open core, e a concessão do SDK não pode sumir
do `LICENSE` — sem ela o produto não é vendável. Verificado por sabotagem nas
três.

**60 arquivos `.md` mencionam MIT, open-core ou self-host.** A maior parte é
CHANGELOG e ADR, que são registro histórico e **não devem ser mexidos**. O
trabalho real está em A5, A6 e A7.

---

## Tabela B — A VPS, para o dia 10

| # | O que fazer | Por quê | Esforço |
|---|---|---|---|
| B1 | **Antes de comprar:** confirmar o datacenter de São Paulo no hPanel e se existe prazo menor que 24 meses | latência, e não travar 24 meses no plano que você vai superar | P |
| B2 | Hardening: SSH só por chave, firewall, atualização automática | a máquina passa a ser sua responsabilidade | P |
| B3 | Docker e compose na máquina | — | P |
| B4 | **Proxy reverso com TLS** (Caddy) na frente da ingestão e da API | hoje as duas falam HTTP puro, com a key no header | P |
| B5 | Cloudflare Free na frente: DNS, TLS, proteção contra ataque | de graça, e é o que substitui a borda do Workers | P |
| B6 | Containers para `apps/web` e `apps/docs` no compose | **não existem**; o self-host não tem nenhum dos dois | M |
| B7 | Container do dashboard e como o build dele chega na máquina | repositório fechado | M |
| B8 | **Backup do ClickHouse** | **feito** — `BACKUP DATABASE` diário para um bucket fora da máquina, com credencial própria; falta **ligar** (um bucket e três variáveis) e pôr regra de ciclo de vida nele | M |
| B9 | Mover o backup do Postgres do Actions para a máquina | **feito** — container `backup`, `pg_dump \| gzip \| age \| rclone` num cano só; o workflow ficou só com o teste de restauração | P |
| B10 | Deploy: como o código chega na VPS | some a integração de git da Vercel | M |
| B11 | Limitar a memória do ClickHouse e ligar swap | ver a nota sobre o KVM 1 | P |
| B12 | Monitor externo (Better Stack free) no heartbeat dos jobs | o `HEARTBEAT_URL` já existe e não aponta para nada | P |

### O que o B8 fez, e o que ele deixou para você

A tarefa `clickhouse-backup` manda o `BACKUP DATABASE` direto do ClickHouse para
um bucket S3, uma vez por dia. Verificado de ponta a ponta: o stack local fez
backup, restaurou noutro banco e as contagens bateram.

Três coisas continuam sendo decisão sua, e sem elas o backup não existe:

1. **Um bucket fora da máquina.** Backup no mesmo disco morre com o disco. O R2
   tem camada gratuita de 10 GB e serve para começar; qualquer S3 serve.
2. **Regra de ciclo de vida nesse bucket.** Nada no código apaga backup velho,
   porque o ClickHouse não apaga objeto em S3. Sem a regra, o bucket cresce até
   a conta doer.
3. **Um teste de restauração de verdade**, depois que a VPS existir. Backup que
   ninguém restaurou é esperança.

### O B9 veio logo depois, e achou um bug que nunca tinha aparecido

O dump do Postgres saiu do GitHub por dois motivos: o Postgres da VPS não
publica porta nenhuma, então um runner do GitHub não o alcança sem expor o banco
na internet; e os minutos do Actions passaram a ser contados quando o
repositório virou privado.

Ao rodar de verdade pela primeira vez, o `pg_dump` falhou: o workflow mandava a
connection string inteira em `PGDATABASE`, e a libpq trata essa variável como
**nome de banco**, não como URI — então ele ignorava host, usuário e senha e
tentava o socket local. **O backup do Postgres nunca teria funcionado.** Ninguém
tinha visto porque o workflow está atrás de uma variável que não existe.

O teste de restauração **continua no Actions**, à mão. Restaurar numa máquina
diferente da que fez o backup é a única versão desse teste que vale: ela
exercita a chave privada do `age`, que é o ponto de falha mais provável de
todos.

### Sobre começar no KVM 1

O KVM 1 é 1 vCPU, 4 GB e 50 GB por R$ 29,99/mês no contrato de 24 meses
(R$ 719,76 adiantado), renovando a R$ 59,99.

Ele roda para provar que funciona, e é razoável começar por ele. O que vai
apertar, para você já saber de onde virá o problema: **o ClickHouse sozinho
fica confortável com 4 GB**, e aqui ele divide 4 GB e um núcleo com o
Postgres, o Valkey, três serviços Node e dois ou três Next.js. Na prática
significa baixar `max_server_memory_usage`, ligar swap e aceitar que consulta
grande vai **falhar** em vez de ficar lenta.

Eu contaria com subir para o KVM 2 antes do primeiro cliente pagante — por
isso o B1 pergunta se existe prazo de 12 meses. Travar 24 meses no plano mais
barato é o pior dos dois mundos.

---

## Tabela C — Cobrança

| # | O que fazer | Por quê | Esforço |
|---|---|---|---|
| C1 | Decidir o modelo: por evento, por assento, por retenção, ou mistura | **a medição por evento já existe e já é à prova de backdate** | P |
| C2 | CNPJ ou MEI, e emissão de nota fiscal | não dá para cobrar sem isso no Brasil | M |
| C3 | Escolher o provedor de pagamento em BRL | o Stripe no Brasil exige CNPJ; Asaas, Pagar.me e Mercado Pago são alternativas | P |
| C4 | **`PaymentProvider` atrás de interface, com implementação de memória** | princípio 2 do plano, e é o que mantém o local de graça | M |
| C5 | Tabelas `plans`, `subscriptions`, `invoices` | — | M |
| C6 | Direitos por plano no `KeyRecord`: retenção, cota, assentos | a ingestão já lê retenção e bloqueio do `KeyRecord` | M |
| C7 | Webhook do provedor (assinatura criada, pagamento falhou, cancelada) | — | M |
| C8 | Suspender quem não pagou | **o `quota-block` já sabe bloquear ambiente pelo KV** — é reaproveitar | P |
| C9 | Cadastro self-serve | hoje a instância é **por convite** | M |
| C10 | Telas de plano, pagamento e faturas | repositório fechado | G |
| C11 | Termos pagos, política de reembolso, SLA, contrato de tratamento de dados | os atuais são de um serviço gratuito de estudo e nunca passaram por advogado | M |

**O que já está construído e serve:** o `usage_per_minute` agrupa por
`received_at` e não pelo relógio do cliente, justamente para ninguém sair da
conta backdateando evento — essa é a metade difícil de cobrança por uso, e
está feita e testada. O `quota-block` já aplica cota diária por ambiente. A
retenção já é coluna. Já existe audit log, matriz de papéis e chave com escopo.

---

## Tabela D — Sem isto não há o que vender

| # | O que fazer | Onde | Esforço |
|---|---|---|---|
| D1 | As 7 telas abertas | repositório fechado | G |
| D2 | Multi-tenant: criar organização, projeto e ambiente pela interface — hoje o self-host semeia **uma** de cada | repositório fechado | G |
| D3 | A fiação que falta: nível mínimo, amostragem e redação no servidor não chegam ao `KeyRecord` do self-host | aqui | M |
| D4 | Destino de `infra/vercel`, `infra/envs` e `infra/vm` | aqui | M |

O D3 é o achado de hoje, e piora com "privado e pago": um cliente pagante cujo
log guarda número de cartão em claro, sem jeito de ligar a redação, não é um
detalhe de configuração.

---

## Tabela E — O que não pode quebrar

Requisito seu: **rodar localmente não pode custar nada.** Hoje isso vale, e
cada item abaixo é uma forma de perder.

| # | Regra | Estado |
|---|---|---|
| E1 | O compose de dev só sobe container livre (ClickHouse, Postgres, Valkey, Mailpit, Garage) | vale hoje — preservar |
| E2 | `PaymentProvider` precisa de implementação de memória, como `Mailer` e `KeyStore` | a construir (C4) |
| E3 | Turnstile no cadastro: usar as chaves de teste oficiais no local | a construir |
| E4 | Nenhum teste pode exigir conta paga | vale hoje — preservar |
| E5 | `deploy/self-host/up.sh` não roda no Windows: é `sh` e exige `openssl` | **quebrado hoje** |

---

## A ordem

1. **Agora, antes de mais código:** A1 e A2. São de graça e param a doação.
2. **Antes do dia 10:** B1, e A3 e A4 junto.
3. **Dia 10 em diante:** o resto da tabela B.
4. **Depois:** A5 a A11 (texto), e a tabela C.
5. **Em paralelo, no outro repositório:** D1 e D2, que continuam sendo o
   caminho crítico de tudo.

O servidor é o item barato desta conta. O caro é a tabela D.
