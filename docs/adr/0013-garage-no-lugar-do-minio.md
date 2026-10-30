# ADR 0013 — Garage no lugar do MinIO para armazenamento S3

- **Status:** aceita
- **Data:** 2026-10-30
- **Plano:** seções 4, 5 e 22
- **Relacionada:** [0003](0003-so-servicos-gratuitos.md) (só serviços gratuitos)

## Contexto

A seção 5 do plano definia **MinIO** como o equivalente self-host do Cloudflare
R2, e o `docker-compose.dev.yml` da etapa 0.10 o usava para o ambiente local.
MinIO é a escolha óbvia: é o que aparece em praticamente todo exemplo de
armazenamento S3-compatível auto-hospedado.

Na primeira vez que a stack subiu de verdade — o Docker só ficou disponível
depois do M0 — o `docker compose up` falhou:

```
pull access denied for minio/minio, repository does not exist or may require 'docker login'
```

Não era erro de tag. Em **setembro de 2026 a MinIO removeu `minio/minio` e
`minio/mc` do Docker Hub**, e o repositório no quay.io passou a exigir
autenticação para qualquer tag, inclusive as fixadas. Os binários avulsos em
`dl.min.io` passaram a responder 410 Gone. É parte de um movimento da empresa
em direção ao produto comercial AIStor.

Isso quebra diretamente a premissa do ADR [0003](0003-so-servicos-gratuitos.md):
a plataforma precisa rodar em peças gratuitas e obteníveis sem conta paga.

## Decisão

Trocar o MinIO pelo **Garage** (`dxflrs/garage`, AGPL-3.0), nos ambientes de
desenvolvimento e self-host. O Cloudflare R2 continua sendo o armazenamento da
instância hospedada — isso não muda.

A verificação foi feita com a stack rodando, não no papel: PUT, LIST e GET de um
objeto real pela API S3, com as credenciais do `.env`, e o conteúdo conferido na
leitura.

## Consequências

- **O `BlobStore` do `internal/adapters` não muda.** Garage fala S3, que é
  exatamente o motivo de a interface existir (princípio 2 do plano). A troca
  ficou contida no `docker-compose` e no `.env.example`.
- **Portas mudaram:** a API S3 passa de `:9000` para `:3900`. O Garage não tem
  console web, então a `:9001` do MinIO deixa de existir.
- **Garage exige inicialização explícita de cluster.** Diferente do MinIO, que
  sobe pronto, é preciso atribuir um layout ao nó antes de qualquer bucket
  existir. Daí o serviço `garage-init`.
- **A inicialização usa a Admin API, não a CLI.** A imagem do Garage é
  distroless, sem `/bin/sh`, então não dá para rodar um script de shell dentro
  dela. O `garage-init` é um container `curlimages/curl` que chama
  `http://garage:3903/v2/...`.
- **Formato de credencial é rígido:** o access key id é `GK` mais 24
  caracteres hex, e o segredo tem **exatamente 64 caracteres hex**. Um segredo
  de outro tamanho é recusado com HTTP 400 e corpo vazio. O `garage-init`
  detecta isso e explica, porque a mensagem do próprio Garage não ajuda.
- **AGPL-3.0.** Não afeta o NekoLog: a obrigação da AGPL recai sobre quem
  modifica e distribui o Garage. Consumimos a API S3 dele pela rede, como
  qualquer cliente — inclusive o dashboard fechado. Se isso incomodar no
  futuro, o SeaweedFS (Apache-2.0) é a saída, com a mesma interface S3.
- **Comunidade menor** que a do MinIO ou do SeaweedFS (~4,8k estrelas contra
  ~36k). É o risco real desta escolha: menos material de apoio e menos olhos
  sobre o projeto.

## Alternativas consideradas

- **Continuar no MinIO via quay.io.** Descartada: exige login para qualquer
  pull, o que quebra CI e qualquer `docker compose up` limpo. Os relatos
  públicos também indicam que o quay só recebe builds de correção sobre uma
  release de 2025, ou seja, nem acompanha o upstream.
- **SeaweedFS** (Apache-2.0, ~36k estrelas). Testado e puxável. Descartado por
  peso: é um sistema de arquivos distribuído completo, com bem mais superfície
  de configuração do que guardar source maps e exportações pede. É o plano B
  natural se a AGPL ou o tamanho da comunidade do Garage virarem problema.
- **LocalStack.** Testado e puxável, mas é um **emulador** da AWS. Resolveria o
  desenvolvimento local e deixaria a seção 5 do plano sem resposta, já que não
  serve como armazenamento real de self-host.
- **Mirror comunitário das imagens do MinIO.** Descartada por segurança: o
  projeto fixa actions por SHA e impõe `minimumReleaseAge` justamente para
  reduzir risco de cadeia de suprimentos (ameaça T4 do modelo de ameaças).
  Depender de uma republicação não verificada contrariaria isso.
- **Chainguard `min.io`.** O nível gratuito só oferece a tag `latest`, sem
  fixação de versão — incompatível com builds reproduzíveis. A imagem também
  não se mostrou puxável no teste.
