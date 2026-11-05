# ADR 0018 — O código chega na VPS por `git pull`, e a imagem é construída lá

- **Status:** aceita
- **Data:** 2026-11-05
- **Plano:** seções 17 e 19
- **Tabela:** [COMERCIAL](../COMERCIAL.md) B10

## Contexto

Até aqui o deploy era a integração de git da Vercel (site e documentação) e o
`wrangler deploy` (Workers). Nenhum dos dois existe no desenho novo: tudo roda
numa VPS Hostinger de 1 vCPU e 4 GB, comprada em 10/11/2026.

A pergunta é simples e a resposta não era: **como o código sai daqui e chega
lá.** Três caminhos foram considerados.

## Decisão

**A máquina tem um clone do repositório, faz `git pull --ff-only` e constrói a
imagem localmente**, por um script (`deploy/self-host/deploy.sh`) que recusa
rodar com árvore suja, fora do branch configurado ou fora de um clone, e que
imprime o comando de rollback antes e depois.

Isso só virou viável porque a imagem encolheu junto, na mesma mudança:
**2,09 GB → 1,05 GB**, e a instalação de dependências caiu de todo o monorepo
para o grafo de produção de quatro aplicações (de 1,3 GB para 12,6 MB de
`node_modules`). Construir 2 GB numa máquina de 1 vCPU, com o ClickHouse rodando
ao lado, não era uma opção; construir isto é.

## Alternativas rejeitadas

### Registry (GHCR), construindo no CI

O caminho padrão, e o que eu teria escolhido numa máquina maior. Recusado por
três motivos somados:

1. **A camada gratuita do GHCR para pacote privado são 500 MB.** A imagem tem
   1,05 GB. Passa a ser cobrado por GB-mês — centavos, mas é uma **superfície
   de cobrança nova** num projeto cujo requisito é não ter custo além do
   domínio e da VPS.
2. **Cada deploy transfere ~1 GB** para a máquina, contra alguns MB de `git
   pull`.
3. **Minutos do Actions passaram a ser contados** quando o repositório virou
   privado (2.000/mês no plano grátis). Um build por deploy consome o que o CI
   dos PRs precisa.

A imagem **não pode ser pública** para escapar da cota: ela carrega o código
proprietário dentro.

Se a máquina crescer ou o deploy ficar frequente, esta é a decisão a revisitar
primeiro — o `deploy.sh` muda para `docker compose pull` e pouco mais.

### `docker save` + `scp`

Sem registry e sem build na máquina, mas transfere ~1 GB de uma conexão
doméstica a cada deploy, e não deixa rastro de qual commit está rodando.

### Construir no CI e enviar só o `node_modules`

Tentador porque o grafo de produção é pequeno, mas `node_modules` do pnpm é uma
árvore de symlinks para um *virtual store*; empacotá-la fora da máquina que a
criou é frágil de um jeito que só aparece em produção.

## Consequências

**O que se ganha:** nenhuma conta nova, nenhum custo novo, o deploy é um `git
pull` de alguns MB, e o commit que está rodando é sempre legível na máquina
(`git rev-parse HEAD`) — o que o registry só daria por convenção de tag.

**O que se aceita:**

- **O build acontece na máquina de produção**, concorrendo por CPU e memória
  com o que está servindo. O `docker compose up -d --build` só troca os
  containers depois que o build termina, então um build que falha deixa o que
  está rodando intacto — mas um build que dá certo e um código que não presta
  derrubam o serviço, e o rollback é manual (o script imprime o comando).
- **O código-fonte fica na máquina**, num clone. Já ficaria, dentro da imagem;
  a diferença é que agora há um `.git` e uma chave de deploy de leitura.
- **Não há artefato imutável.** Dois deploys do mesmo commit podem produzir
  imagens diferentes se uma dependência de sistema mudar no Alpine. O
  `pnpm-lock.yaml` prende o lado do Node; o `apk add` não está preso.
- **O CI não produz o que a produção roda.** Em troca,
  `.github/workflows/self-host.yml` constrói a mesma imagem em todo PR que toca
  nela e exige que os quatro pontos de entrada subam e recusem pelo motivo
  certo — que é o que pega uma instalação de dependências quebrada antes dela
  chegar na máquina.
