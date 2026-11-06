# Runbooks

Procedimentos para quando algo dá errado. Escritos para serem seguidos **sob
pressão**, por uma pessoa só, possivelmente de madrugada: passos numerados,
decisões explícitas, nada de "é só ajustar a configuração".

| Runbook | Quando usar |
|---|---|
| [incidente.md](incidente.md) | Qualquer coisa fora do ar, lenta ou comportando-se de forma estranha. É o ponto de entrada. |
| [vazamento-de-key.md](vazamento-de-key.md) | Uma key de API foi exposta — do cliente ou da plataforma. |
| [rotacao-de-segredos.md](rotacao-de-segredos.md) | Trocar senha de banco, chave de criptografia, segredo de webhook ou token de provedor, por rotina ou por comprometimento. |
| [restauracao-de-backup.md](restauracao-de-backup.md) | Perda ou corrupção de dados no Postgres ou no ClickHouse. |

## A plataforma que estes runbooks descrevem

**Uma máquina.** Em 05/11/2026 o item D4 removeu o Cloudflare Workers,
o Workers KV, o Tunnel, o Access, a VM da Oracle e a Vercel; o Neon e o Upstash
saíram junto, porque o Postgres virou um container ao lado dos outros e não há
Redis nenhum. O que sobrou do Cloudflare é o plano gratuito na frente da
máquina — DNS e proxy — mais um bucket R2 para os backups.

```
Cloudflare Free (DNS + proxy)
  └── VPS ── Caddy ── ingest ── ClickHouse
                   ├─ api ──── ClickHouse + Postgres
                   ├─ jobs ─── ClickHouse + Postgres
                   ├─ web  (página pública)
                   └─ docs (documentação)
            containers de apoio: postgres, bootstrap, backup
```

Os containers estão em [`deploy/self-host/`](../../deploy/self-host/README.md), e
é aquele README que diz o que cada um faz. O dashboard **não roda aqui**: ele é
fechado, mora em outro repositório e é item B7 de
[COMERCIAL.md](../COMERCIAL.md).

## Estado destes runbooks

- **Nada disto foi executado.** Não existe máquina ainda — comprá-la é o item B1
  de [COMERCIAL.md](../COMERCIAL.md). Os comandos são o procedimento pretendido,
  derivado do que o código e o compose fazem, não um passo a passo testado.
- **Onde falta informação concreta** (endereço da máquina, nome do bucket,
  usuário de SSH), o texto está marcado com `«...»`. Preencher quando a máquina
  existir.
- **Cada runbook precisa ser exercitado pelo menos uma vez** antes de valer como
  runbook de verdade. Um procedimento nunca testado falha exatamente quando é
  necessário. O plano já prevê isso para a restauração de backup
  ([PLANO.md](../PLANO.md), seção 15.3).
- O que **não** está escrito aqui é o endurecimento da própria máquina — SSH só
  por chave, firewall, atualizações automáticas. Isso é o item B2, e até ele
  acontecer o acesso à máquina é o elo mais fraco de todo este documento.

Atualize o runbook **durante** o incidente, não depois: o que você descobriu que
estava errado é a parte mais valiosa.

## Contatos e acessos

Projeto de uma pessoa: o autor é quem responde. Os acessos necessários estão
todos protegidos por passkey ou chave de segurança (plano, seção 14.2) —
perder o segundo fator **é** um incidente, e o caminho de recuperação de cada
provedor precisa estar guardado fora do computador de trabalho.

São três provedores e um servidor:

| Onde | Para quê | Perder o acesso significa |
|---|---|---|
| Hostinger | a máquina | Não dá para reiniciar nem reinstalar nada |
| Cloudflare | DNS, proxy e o bucket dos backups | Os nomes não resolvem; os backups ficam inalcançáveis |
| Resend | e-mail de alerta e de exportação | Ninguém recebe aviso nenhum |
| GitHub | o código e o teste de restauração | Não dá para fazer deploy, que é `git pull` na máquina |

Reporte externo de vulnerabilidade chega pelo private vulnerability reporting do
GitHub ou por `security@nekolog.io` — ver [SECURITY.md](../../SECURITY.md).
