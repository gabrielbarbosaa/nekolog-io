# Custos — quatro arquiteturas, com preço

> Levantado em 05/11/2026, nas páginas oficiais de cada fornecedor, exceto
> onde está marcado. **Preço de nuvem muda sem aviso** — a seção 23 do
> [PLANO.md](PLANO.md) já registra isso, e a Oracle provou em junho. Confirme
> antes de assinar qualquer coisa. Conversão a **R$ 5,50 por dólar**, só para
> comparar ordens de grandeza.

## O que precisa estar no ar

| # | Peça | Perfil |
|---|---|---|
| 1 | Ingestão | sempre ligada, rajada, latência importa, perder requisição é perder dado do cliente |
| 2 | ClickHouse | memória e disco; é onde moram os logs |
| 3 | Postgres | pequeno, mas é a verdade sobre contas, projetos e issues |
| 4 | Redis/Valkey | pequeno; só o dashboard usa, para sessão |
| 5 | Jobs | cron de um minuto |
| 6 | API de leitura | tráfego baixo |
| 7 | Site e documentação | estáticos na prática |
| 8 | Dashboard | Next.js em `apps/dashboard`; **7 telas em aberto** |
| 9 | Object storage | spool, source maps, exportações e backup |
| 10 | E-mail | código de login, alerta, exportação pronta |
| 11 | DNS, TLS, CDN e proteção contra ataque | — |

---

## Cenário A — o desenho de hoje, tudo em plano gratuito

| Serviço | Plano | Limite que aperta primeiro | Custo |
|---|---|---|---|
| Cloudflare Workers | Free | 100 mil req/dia, **10 ms de CPU**, KV com 1.000 escritas/dia | US$ 0 |
| Oracle Always Free | A1.Flex | **cortado para 2 OCPU e 12 GB em 15/06/2026** | US$ 0 |
| Neon | Free | 100 CU-hora, 1 GB, hiberna em 5 min sem desligar | US$ 0 |
| Upstash Redis | Free | 500 mil comandos/mês, 250 MB | US$ 0 |
| Vercel | Hobby | **proíbe uso comercial** | US$ 0 |
| Resend | Free | 3.000/mês e **100 por dia** | US$ 0 |
| Cloudflare R2 | Free | 10 GB, 1 M classe A, 10 M classe B | US$ 0 |
| Domínio `.io` | — | — | ~US$ 50/ano |

**Custo: ~R$ 25/mês**, só o domínio.

**Dois problemas, e um é novo.** O Vercel Hobby proíbe uso comercial, o que o
plano já registrava. E a Oracle não só cortou a cota pela metade como passou a
**recuperar instância ociosa** — CPU, rede e memória abaixo de 20% no
percentil 95 durante 7 dias. Uma instância de log com pouco tráfego é
exatamente o perfil que se encaixa nesse critério. O risco que a seção 22 do
plano listava como "a Oracle reduz a cota" já aconteceu, e virou dois.

---

## Cenário B — a mesma arquitetura, pagando

Trocar cada plano gratuito pelo primeiro pago, sem mexer no desenho.

| Serviço | Plano | Preço | Observação |
|---|---|---|---|
| Cloudflare Workers | Paid | **US$ 5** | 10 M req/mês; **a CPU sobe de 10 ms para 30 s** |
| Vercel | Pro | **US$ 20** | 1 assento, 1 TB de CDN; assento extra US$ 20 |
| Neon | Launch | ~US$ 15–19 | US$ 0,106/CU-hora + US$ 0,35/GB; sem mínimo |
| Upstash | Fixed 250MB | US$ 10 | ou pago por uso, ~US$ 0,20 por 100 mil comandos |
| Resend | Pro | US$ 20 | 50 mil/mês, sem limite diário |
| R2 | Standard | ~US$ 1 | 10 GB grátis cobrem o começo |
| VM do ClickHouse | — | US$ 0–25 | Oracle (com o risco acima) ou VPS pago |
| Domínio | — | ~US$ 4 | — |

**Custo: US$ 75 a 100/mês — R$ 410 a 550/mês.**

E repare: **a maior parte desse dinheiro não compra nada que este projeto
use.** O Neon vale pelo branch e pelo scale-to-zero, e a seção 22 do plano
lista a hibernação do Neon como um *problema* que a arquitetura contorna. O
Upstash vale pela distribuição global, e aqui ele guarda sessão. O Vercel vale
pelo preview por branch e pelo edge, para dois apps Next e um site estático de
tráfego baixo.

---

## Cenário C — um VPS só

É a pergunta que você fez, e ela tem uma resposta boa: **o `deploy/self-host`
já é essa arquitetura.** Ele roda ClickHouse, Postgres, ingestão, jobs e API de
leitura em seis containers numa máquina. Faltam o site, a documentação e o
dashboard.

### A Hostinger, com a letra miúda

Preços da página oficial brasileira, lidos hoje:

| Plano | vCPU | RAM | NVMe | Promocional | **Renovação** | Total do contrato |
|---|:-:|:-:|:-:|---|---|---|
| KVM 1 | 1 | 4 GB | 50 GB | R$ 29,99 | R$ 59,99 | R$ 719,76 |
| KVM 2 | 2 | 8 GB | 100 GB | R$ 42,99 | R$ 77,99 | R$ 1.031,76 |
| **KVM 4** | **4** | **16 GB** | **200 GB** | **R$ 59,99** | **R$ 149,99** | **R$ 1.439,76** |
| KVM 8 | 8 | 32 GB | 400 GB | R$ 119,99 | R$ 259,99 | R$ 2.879,76 |

Três coisas que mudam a conta:

1. **O preço promocional exige 24 meses, pagos adiantado.** O KVM 4 a
   "R$ 59,99/mês" é R$ 1.439,76 na frente. A mensalidade é o total dividido
   por 24, não uma assinatura mensal.
2. **A renovação é automática, por mais 24 meses, ao preço cheio** — que no
   KVM 4 é 2,5× o promocional. O custo honesto de planejamento é
   **R$ 149,99/mês**, não R$ 59,99.
3. **Tem datacenter em São Paulo**, anunciado em 2022. Para ingestão vinda de
   aplicação brasileira, isso vale latência de verdade. Confirme no hPanel
   antes de assinar — a página de planos não lista as cidades.

### O tamanho honesto

ClickHouse confortável quer 4 a 8 GB. Somando Postgres, Valkey, três serviços
Node e dois ou três Next.js, **16 GB é o número honesto** — ou seja, KVM 4. Os
8 GB do KVM 2 rodam, mas com o ClickHouse apertado, que é justamente a peça
onde apertar dói.

### Alternativas, porque a Hostinger não é a única

| Fornecedor | Oferta | Preço | Ressalva |
|---|---|---|---|
| Contabo | 4 vCPU, 8 GB, 100 GB | ~€ 5,50 (~R$ 32) | vCPU compartilhado; **sem trava de 24 meses** |
| Hetzner CPX22 | 2 vCPU dedicado, 4 GB | ~€ 20 (~R$ 115) | **subiu 144–176% em junho de 2026** e anda sem estoque |
| Hostinger KVM 4 | 4 vCPU, 16 GB, 200 GB | R$ 150 na renovação | datacenter em SP; trava de 24 meses |

A Contabo é de longe a melhor relação memória por real, e sem contrato longo.
A Hetzner deixou de ser a escolha óbvia este ano.

### A conta do cenário C

| Item | Custo |
|---|---|
| VPS (KVM 4, renovação) | R$ 150 |
| Cloudflare Free na frente — DNS, TLS, CDN, proteção contra ataque | R$ 0 |
| Resend Free (100/dia) | R$ 0 |
| R2 para o backup fora da máquina | ~R$ 6 |
| Domínio | ~R$ 25 |

**Custo: ~R$ 180/mês na renovação, ~R$ 90/mês no primeiro contrato.**
Três vezes mais barato que o cenário B.

---

## Cenário D — híbrido, e é o que eu recomendaria

Um VPS para tudo que tem estado, e **só a ingestão fica no Cloudflare**.

| Item | Custo |
|---|---|
| VPS (KVM 4 ou Contabo) | R$ 32 a R$ 150 |
| Cloudflare Workers Paid (só a ingestão) | US$ 5 (~R$ 28) |
| R2 | ~R$ 6 |
| Resend Free | R$ 0 |
| Domínio | ~R$ 25 |

**Custo: R$ 90 a R$ 210/mês.**

Por que pagar os US$ 5 em vez de pôr a ingestão no VPS também:

- **A ingestão é o único caminho onde queda é perda de dado do cliente.** O
  resto pode ficar fora do ar por dez minutos sem ninguém perder nada.
- **Os 10 ms de CPU somem.** O plano pago dá 30 s por invocação. O limite mais
  apertado do projeto inteiro — o que obrigou a memoizar o fingerprint e a
  baixar o lote padrão de 500 para 200 — custa US$ 5 para desaparecer. O
  trabalho não foi perdido: 200 eventos a 2,1 ms continua sendo melhor
  engenharia. Mas a restrição é comprável.
- O código, o `wrangler.json` dos três ambientes e os módulos de
  infraestrutura já existem e já foram testados em dry-run.
- 10 milhões de requisições por mês por US$ 5 é mais barato que a banda
  equivalente em qualquer VPS.

---

## Resumo

| | A — grátis | B — nuvem paga | C — um VPS | D — híbrido |
|---|---|---|---|---|
| Custo/mês | R$ 25 | R$ 410–550 | R$ 180 | R$ 90–210 |
| Pode cobrar? | **Não** (Vercel Hobby) | Sim | Sim | Sim |
| Risco de a base sumir | **Alto** (Oracle recupera ocioso) | Baixo | Médio (disco seu) | Médio |
| Ingestão protegida na borda | Sim | Sim | **Não** | Sim |
| Operação | Nenhuma | Pouca | **Toda sua** | Quase toda sua |
| Trabalho para chegar lá | — | Pouco | **Muito** | Médio |

---

## O que trocar, item por item

| Serviço | Trocar? | Economia/mês | O que você perde |
|---|---|---|---|
| Vercel → VPS | **Sim** | US$ 20 | preview por branch (era a razão do `infra/vercel`, etapa 2.22) e o CDN automático — o Cloudflare Free cobre o CDN |
| Neon → Postgres no VPS | **Sim** | ~US$ 17 | branch de banco e scale-to-zero, que este projeto trata como problema, não recurso |
| Upstash → Valkey no VPS | **Sim** | US$ 10 | distribuição global de uma sessão; já está no compose de dev |
| Oracle → VPS pago | **Sim** | — | a cota caiu pela metade e instância ociosa é recuperada |
| Workers → VPS | **Não** | US$ 5 | borda, proteção contra ataque e o fim do limite de 10 ms |
| R2 → disco local | **Não** | ~US$ 1 | a cópia fora da máquina, que é o ponto inteiro de ter backup |
| Resend | **Não** | — | 100/dia cobrem uma instância por convite |

---

## O que o VPS obriga a construir, e hoje não existe

Essa é a parte que o preço esconde. Nenhum destes itens está feito:

1. **TLS e proxy reverso.** A ingestão e a API falam HTTP puro, com a key no
   header `Authorization`. Hoje isso é aceitável porque nada está exposto.
2. **Containers para o site, a documentação e o dashboard.** O `self-host` não
   tem nenhum dos três. A reescrita de `/docs` hoje é feita pelo `next.config`
   na Vercel e precisaria de outro dono.
3. **Backup dos logs — que não existe em lugar nenhum.** O `backup.yml` faz
   `pg_dump` do Postgres. O ClickHouse é um volume, numa máquina, sem cópia.
   Para uma instância de estudo é defensável; cobrando, é inaceitável.
4. **Deploy.** Some a integração de git da Vercel; entra alguma coisa que
   constrói e reinicia containers na máquina.
5. **Três ambientes numa máquina.** O `self-host` é de um ambiente só.
6. **Multi-tenant.** O `self-host` semeia **uma** organização e **um** projeto.
   Quem cria organização e projeto é o dashboard — fechado, com 7 telas
   abertas. Sem isso não existe segundo cliente.

Os itens 1 a 5 são trabalho conhecido. O **6 não é custo de infraestrutura, é
o mesmo bloqueio de sempre**: sem dashboard não há produto para vender, em
nuvem nenhuma.

---

## Ponto de equilíbrio

Com o cenário D a R$ 150/mês de piso, e supondo um preço por cliente:

| Preço/cliente | Clientes para empatar |
|---|---|
| R$ 29 | 6 |
| R$ 49 | 4 |
| R$ 99 | 2 |

O número é pequeno porque o custo é pequeno. **O que não é pequeno é o custo
de chegar lá** — as 7 telas, a cobrança, o cadastro self-serve, o backup dos
logs, a nota fiscal e o suporte. O servidor é o item barato desta conta.
