# Runbooks

Procedimentos para quando algo dá errado. Escritos para serem seguidos **sob
pressão**, por uma pessoa só, possivelmente de madrugada: passos numerados,
decisões explícitas, nada de "é só ajustar a configuração".

| Runbook | Quando usar |
|---|---|
| [incidente.md](incidente.md) | Qualquer coisa fora do ar, lenta ou comportando-se de forma estranha. É o ponto de entrada. |
| [vazamento-de-key.md](vazamento-de-key.md) | Uma key de API foi exposta — do cliente ou da plataforma. |
| [rotacao-de-segredos.md](rotacao-de-segredos.md) | Trocar chave JWT, segredo de OTP, senha de banco ou token de deploy, por rotina ou por comprometimento. |
| [restauracao-de-backup.md](restauracao-de-backup.md) | Perda ou corrupção de dados no Postgres. |

## Estado destes runbooks

**Eles descrevem a plataforma anterior, e ela não existe mais.** Em 05/11/2026
o item D4 removeu o Cloudflare Workers, o Workers KV, o Tunnel, o Access, a VM
da Oracle e a Vercel; o Neon e o Upstash saíram junto, porque o Postgres e o
Redis passaram a ser containers na mesma máquina. Tudo roda numa VPS. Então
cada passo que diz "painel do Cloudflare Zero Trust", "branch do Neon",
"cota do Worker" ou "reverta pela Vercel" está errado hoje.

Reescrevê-los é parte do item **D5**, e faz sentido fazer isso **junto com a
máquina** (itens B2 e B3): um runbook escrito antes de existir o que ele
descreve é o rascunho que esta seção já advertia ser. O que continua válido é
a forma — passos numerados, decisões explícitas — e a parte do
`rotacao-de-segredos.md` sobre o `TF_ENCRYPTION`, que é a mesma.

Além disso, e desde antes:

- **Os comandos não foram executados.** São o procedimento pretendido, derivado
  do plano, não um passo a passo testado. Trate-os como rascunho a conferir.
- **Onde falta informação concreta** (ID de recurso, nome exato de secret,
  endereço), o texto está marcado com `«...»`. Preencher conforme a
  infraestrutura for criada.
- **Cada runbook precisa ser exercitado pelo menos uma vez** antes de valer como
  runbook de verdade. Um procedimento nunca testado falha exatamente quando é
  necessário. O plano já prevê isso para a restauração de backup (teste a cada
  marco, seção 15.3).

Atualize o runbook **durante** o incidente, não depois: o que você descobriu que
estava errado é a parte mais valiosa.

## Contatos e acessos

Projeto de uma pessoa: o autor é quem responde. Os acessos necessários estão
todos protegidos por passkey ou chave de segurança (plano, seção 14.2) —
perder o segundo fator **é** um incidente, e o caminho de recuperação de cada
provedor precisa estar guardado fora do computador de trabalho.

Reporte externo de vulnerabilidade chega pelo private vulnerability reporting do
GitHub ou por `security@nekolog.io` — ver [SECURITY.md](../../SECURITY.md).
