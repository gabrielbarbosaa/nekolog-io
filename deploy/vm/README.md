# deploy/vm

O que roda **dentro** da VM da Oracle: um ClickHouse e um `cloudflared` por
ambiente. O `infra/vm` renderiza estes arquivos no cloud-init; aqui eles vivem
em forma legível e versionada.

```
docker-compose.yml           clickhouse + init + três túneis + o do ssh
clickhouse/users.xml.tftpl   dez usuários, com a senha só em hash
clickhouse/init/*.sql        um CREATE DATABASE por arquivo
cloud-init.yaml.tftpl        o que a Oracle entrega para a máquina no boot
```

## Uma máquina, três ambientes

O plano (seção 17) diz: um database por ambiente **na mesma VM**. Então a
separação não pode vir da máquina — ela vem das credenciais.

São dez usuários: `reader`, `ingest` e `jobs` **por ambiente**, mais um
`migrator` e o `default`. `nekolog_ingest_prod` não enxerga `nekolog_dev`, e
vice-versa. No `docker-compose.dev.yml` existe só um conjunto, porque lá existe
um ambiente só.

O `migrator` é o único com DDL, e mesmo ele está preso aos três databases: ele
pode criar `nekolog_dev`, `nekolog_qa` e `nekolog_prod`, e nada mais.

## Três túneis, não um

A etapa 1.16 criou um Cloudflare Tunnel **por ambiente**, e eles terminam todos
nesta mesma máquina. Isso parece desperdício, e a alternativa seria um túnel só
com três hostnames.

A escolha é deliberada: cada `cloudflared` tem seu próprio arquivo de
credenciais, e o segredo de cada um vive só no estado daquele ambiente. Com um
túnel compartilhado, quem roubasse o arquivo passaria a servir os três
hostnames, e o segredo estaria num estado que o pipeline de `dev` também
escreve. Três processos Go de ~30 MB numa máquina de 12 GB é um preço barato por
esse raio de dano menor.

## Nenhuma porta, em dois níveis

A lista de segurança da OCI não tem **nenhuma** regra de entrada — só saída, que
é o que o túnel precisa para discar. E o `docker-compose.yml` não publica porta
nenhuma: o ClickHouse só existe na rede dos containers.

Os usuários também só aceitam conexão de `172.28.0.0/16`, a sub-rede do compose.
O `default` é a exceção: ele só aceita `127.0.0.1`, porque não existe para ser
usado de fora.

## O quarto túnel é o do SSH

A porta 22 não aceita ninguém de fora: a lista de segurança da OCI não tem regra
de entrada. O caminho até o `sshd` é um `cloudflared` a mais, atrás de uma
aplicação Access que só aceita os e-mails de operador
([`infra/modules/ssh-access`](../../infra/modules/ssh-access)):

```bash
cloudflared access ssh --hostname ssh.nekolog.io
```

Duas coisas nele são de propósito e parecem erro:

- **Ele não está na rede `inside`.** Um túnel de SSH não tem o que fazer perto
  do ClickHouse. Ele fica na `outside` e chega ao host por
  `host.docker.internal`, que o `extra_hosts` resolve para o gateway do Docker.
- **Ele não espera o healthcheck do ClickHouse.** Os outros três esperam, porque
  servir 502 enquanto o banco sobe não ajuda ninguém. Já o SSH é justamente o que
  você quer quando o ClickHouse **não** está saudável; amarrá-lo ao healthcheck
  tiraria o acesso exatamente na hora do incidente.

## O entrypoint da imagem não cria os databases

Vale registrar, porque custou uma hora: a imagem oficial roda os scripts de
`/docker-entrypoint-initdb.d` como `default`, pelo loopback e **sem senha**.
Como aqui o `default` tem senha, isso falha — e falha **em silêncio**: o
container sobe saudável e os databases simplesmente não existem.

Por isso os `CREATE DATABASE` não ficam no entrypoint. Um serviço `clickhouse-init`
espera o healthcheck e aplica cada arquivo como `nekolog_migrator`, via HTTP, um
comando por arquivo — a mesma convenção da
[especificação 3](../../docs/ESPECIFICACOES.md).

## Conferindo sem a VM

Dá para subir só o ClickHouse desta pasta localmente e conferir as regras. É o
que foi feito nesta etapa: **31 afirmações, todas passando**, contra o
ClickHouse 26.8 de verdade. Entre elas:

- os três databases existem depois do `clickhouse-init`;
- `ingest_dev` escreve em `nekolog_dev` e é recusado em `nekolog_prod`;
- `ingest_*` lê `level` (a *materialized view* precisa) e **não** lê `message`;
- `reader_prod` lê `nekolog_prod`, é recusado em `nekolog_dev` e não escreve;
- nenhum deles faz `DROP`, e nem o `migrator` cria um database fora dos três;
- o `default` funciona pelo loopback e a **mesma senha** é recusada pela rede.

A última é a que prova que a restrição é de rede, e não senha errada. O
ClickHouse não diz "endereço não permitido" — ele responde a mesma coisa de uma
senha errada, de propósito.

O que roda no CI é o [`grants.test.ts`](../../internal/clickhouse/src/grants.test.ts),
que lê este template **e** o do dev e exige as mesmas invariantes de *grant*.
Ele não sobe container nenhum: alguém alargar um `GRANT` quebra o teste na hora,
que é a regressão realista.
