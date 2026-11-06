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
| B5 | Cloudflare Free na frente: DNS, TLS, proteção contra ataque | de graça, e é o que substitui a borda do Workers | P — **declarado** em `infra/vps`; falta a conta |
| B6 | Containers para `apps/web` e `apps/docs` no compose | **feito** — Next em standalone (299 MB) e a documentação estática num Caddy próprio (89 MB); o proxy roteia `/docs` direto, sem passar pelo Next | M |
| B7 | Container do dashboard e como o build dele chega na máquina | repositório fechado | M |
| B8 | **Backup do ClickHouse** | **feito** — `BACKUP DATABASE` diário para um bucket fora da máquina, com credencial própria; falta **ligar** (um bucket e três variáveis) e pôr regra de ciclo de vida nele | M |
| B9 | Mover o backup do Postgres do Actions para a máquina | **feito** — container `backup`, `pg_dump \| gzip \| age \| rclone` num cano só; o workflow ficou só com o teste de restauração | P |
| B10 | Deploy: como o código chega na VPS | **feito** — clone na máquina, `deploy.sh` com `git pull --ff-only` e build local; a imagem caiu de 2,09 GB para 1,05 GB, que é o que torna isso viável num 1 vCPU ([ADR 0018](adr/0018-deploy-por-git-pull-na-maquina.md)) | M |
| B11 | Limitar a memória do ClickHouse e ligar swap | ver a nota sobre o KVM 1 | P |
| B12 | Monitor externo (Better Stack free) no heartbeat dos jobs | o `HEARTBEAT_URL` já existe e não aponta para nada | P |

### O que o B8 fez, e o que ele deixou para você

A tarefa `clickhouse-backup` manda o `BACKUP DATABASE` direto do ClickHouse para
um bucket S3, uma vez por dia. Verificado de ponta a ponta: o stack local fez
backup, restaurou noutro banco e as contagens bateram.

Eram três coisas; o D4 declarou duas, e uma continua aberta:

1. ~~**Um bucket fora da máquina.**~~ `infra/vps` cria `nekolog-backups` no R2,
   com `prevent_destroy`. Falta a conta para aplicar.
2. ~~**Regra de ciclo de vida nesse bucket.**~~ Também no D4, e ela expira **só
   o prefixo `clickhouse/`** — o backup do Postgres apaga os próprios arquivos
   pelo `BACKUP_KEEP_DAYS`, e duas retenções sobre o mesmo objeto seriam duas
   verdades. Um teste compara o prefixo da regra com o que o código escreve.
3. **Um teste de restauração de verdade**, depois que a VPS existir. Backup que
   ninguém restaurou é esperança. **Este continua sendo seu.**

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

### O B10 encolheu a imagem antes de decidir qualquer coisa

A pergunta era "registry ou build na máquina". A resposta dependia de um número
que ninguém tinha medido: **a imagem pesava 2,09 GB**, sendo 1,3 GB de
`node_modules` — o monorepo inteiro instalado para rodar quatro processos Node.

Com isso, as duas opções eram ruins: construir 2 GB num 1 vCPU ao lado do
ClickHouse, ou pagar um registry e transferir 1 GB por deploy (a camada gratuita
do GHCR para pacote privado são 500 MB, e a imagem não pode ser pública porque
carrega o código).

Instalando só o grafo de produção das quatro aplicações, `node_modules` caiu
para **12,6 MB** e a imagem para **1,05 GB** — o resto é a base Alpine e os
binários do backup. O build na máquina passou a ser razoável, e o deploy passou
a ser um `git pull` de alguns MB, sem conta nova e sem custo novo.

O que se aceita está no [ADR 0018](adr/0018-deploy-por-git-pull-na-maquina.md),
e o principal é: **o rollback é manual.** Um build que falha não derruba nada;
um build que dá certo com código ruim derruba, e o script imprime o comando de
volta.

### O B6 achou uma política de segurança que ia sumir no caminho

A documentação é estática e sai do Astro com uma CSP de **hashes** — um por
script inline que o build emitiu. Na Vercel isso vive num `vercel.json`, que o
build regenera e confere. **Num container, esse arquivo não significa nada**: a
documentação teria ido para a VPS sem CSP nenhuma e ninguém perceberia, porque
nenhum teste olha para isso.

Agora o mesmo gerador escreve também um bloco de header do Caddy, **dentro da
imagem**, a partir do `dist/` que acabou de ser construído — não dá para
divergir. Um teste compara as duas saídas.

E o proxy roteia `/docs` direto para o container da documentação em vez de pelo
`rewrite` do Next. Além de economizar um salto, é o que faz cada um responder
com a sua própria política: a landing com nonce, a documentação com hashes.

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
| D3 | A fiação que falta: nível mínimo, amostragem e redação no servidor não chegam ao `KeyRecord` do self-host | **feito** — documento do seed na versão 2, `seed set`, e a ingestão relendo o arquivo sem reiniciar | M |
| D4 | Destino de `infra/vercel`, `infra/envs` e `infra/vm` | **feito** — removidas, junto com os Workers que as consumiam; entrou `infra/vps` no lugar | M |
| D5 | Reescrever o `docs/PLANO.md` e os `docs/runbooks/` para a arquitetura que existe | **feito** — plano e runbooks reescritos para a máquina; `internal/self-host/src/runbooks.test.ts` falha se um runbook voltar a citar provedor removido, apontar para arquivo que não existe ou inventar variável. Nenhum foi **exercitado**: isso só acontece com a máquina (B2/B3) | M |

O D3 é o achado de hoje, e piora com "privado e pago": um cliente pagante cujo
log guarda número de cartão em claro, sem jeito de ligar a redação, não é um
detalhe de configuração.

### O que o D4 removeu, e o que colocou no lugar

Saíram três raízes de OpenTofu (`envs/{dev,qa,prod}`, `vercel`, `vm`), nove
módulos, o `deploy/vm/` que rodava dentro da máquina da Oracle, e — porque sem
`infra/envs` eles ficariam sem infraestrutura nenhuma — os três Workers: os
`wrangler.json`, os `worker.ts`, o `@internal/deploy`, o
`deploy/workers/secrets.json` e o workflow `Workers`. São 84 arquivos.
**Nenhuma daquelas raízes foi aplicada uma única vez**, então não há estado
órfão em conta nenhuma; o que elas diziam continua no histórico do git.

Entrou `infra/vps`, que faz as duas coisas que a máquina realmente precisa da
Cloudflare: os registros A de cada nome que o Caddy atende, *proxied* (é o item
**B5**), e o bucket de backup com regra de ciclo de vida — que fecha dois dos
três pendentes do **B8**. O terceiro, restaurar de verdade, continua esperando
a máquina.

Três consequências que não eram óbvias:

1. **O `worker.ts` de cada app não era só a entrada do Worker.** Ele carregava
   também a fiação que as entradas Node usam, então os três viraram arquivos
   próprios (`rate.ts` na ingestão, `deps.ts` na API, o `wiring.ts` dos jobs) em
   vez de sumirem.
2. **A política de privacidade nomeia os processadores, e metade deles deixou
   de existir.** Oracle, Neon, Upstash e Vercel saíram; entrou a Hostinger. Nos
   três idiomas, porque é isso que o teste de paridade exige.
3. **O `docs/PLANO.md` e os runbooks descrevem a plataforma antiga inteira** e
   não deu para consertar junto. Viraram o **D5**.

### O D5 reescreveu o plano, e um número mudou de dono

O `docs/PLANO.md` já descreve a máquina que existe: a arquitetura, o que roda
onde, a segurança da infraestrutura, a operação, a infraestrutura como código,
o fluxo de branches, a estrutura do repositório e a tabela de riscos. A licença
proprietária também entrou na tabela de decisões, que ainda dizia MIT.

**Os 10 ms de CPU por request mudaram de dono sem mudar de valor.** Eles eram o
teto do Cloudflare Workers no plano gratuito — um limite de plataforma. A VPS
não impõe nenhum, mas é **1 vCPU dividido** com o ClickHouse, o Postgres, quatro
processos Node e o proxy: CPU gasta na ingestão é CPU tirada do banco que ela
mesma vai consultar. O número ficou, como teto auto-imposto, e a constante
deixou de se chamar `WORKER_CPU_BUDGET_MS`. O que ele obrigou a fazer —
memoizar o fingerprint por lote, baixar o lote padrão de 500 para 200 —
continua valendo, e a landing page continua contando essa história, agora sem
mencionar Worker, nos três idiomas.

**Os runbooks ficaram de fora, de propósito.** Eles mandam abrir o painel do
Cloudflare Zero Trust e criar branch no Neon, e reescrevê-los antes de existir a
máquina produziria exatamente o rascunho que o `docs/runbooks/README.md` adverte
não seguir. Vão junto com o **B2** e o **B3**.

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
