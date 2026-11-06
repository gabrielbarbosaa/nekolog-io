# @internal/auth

Autenticação escrita à mão, pelo motivo do ADR
[0007](../../docs/adr/0007-autenticacao-propria.md). Segue a seção 11 do
[plano](../../docs/PLANO.md). Nasce com as senhas (etapa 2.5); códigos, tokens,
sessões e as rotas chegam nas etapas seguintes.

## Senhas

`hashPassword` e `verifyPassword` usam **argon2id** com 19 MiB, 2 iterações e
paralelismo 1 — o mínimo que a OWASP recomenda, e o que o plano escreve. O teste
não confere só as constantes: ele lê o custo de dentro do digest produzido, que
é o que de fato roda.

`verifyPassword` **devolve `false` em vez de lançar** quando o digest é ilegível.
Um hash corrompido no banco é uma senha que não confere, não uma rota que
explode.

`digestNeedsRehash` diz quando um digest veio de um custo antigo. Quem logar com
sucesso pode ser reescrito com o custo atual — é o caminho para subir o custo
sem pedir nada a ninguém.

## O tempo de uma conta que não existe

A seção 11.1 exige que "e-mail ou senha inválidos" demore o mesmo quando o
e-mail não existe. `spendTheSameTime` roda uma verificação argon2 de verdade
contra `absentAccountDigest()`, que é hasheado **uma vez** e guardado: o custo
existe para a tentativa, não para o processo. Um digest falso de mentira (uma
string qualquer) não serviria, porque `verify` recusaria o formato na hora e
voltaria rápido — o teste confere que ele é um digest real do custo atual.

## Pwned Passwords falha aberto, e isso é uma escolha

A consulta é *k-anonymity*: saem **cinco caracteres** do SHA-1 e nada mais — há
teste de que a URL não contém o sufixo nem a senha. O cabeçalho `Add-Padding`
pede que a resposta tenha sempre o mesmo tamanho, senão o tamanho dela já diria
algo. Há deadline de 2 s.

Quando a API não responde, o resultado é **`unknown`** e a senha **passa**. É o
oposto da regra que vale no resto deste repositório ("não consegui medir" é
alarme, não silêncio), e a diferença é quem paga: ali quem paga é o operador,
aqui quem paga é alguém tentando criar uma conta num dia em que um serviço de
terceiro caiu. O mínimo de 12 caracteres continua valendo, e é ele que tira as
senhas triviais de circulação.

O `unknown` não é engolido: `checkPassword` devolve `breachCheck: 'unknown'`
junto com `accepted: true`, para quem chama registrar que a checagem não rodou.

## O que foi conferido contra a API de verdade

Em 06/11/2026, pelo módulo, sem mock: `password123456` e `qwertyuiop1234`
voltaram `breached`, e uma senha longa aleatória voltou `clean`. Isso é o que
prova o SHA-1, a divisão prefixo/sufixo e a leitura da resposta ao mesmo tempo.
**Não há teste de rede no CI**: um terceiro fora do ar não pode deixar este
repositório vermelho.
