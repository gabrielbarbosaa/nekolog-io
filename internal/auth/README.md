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

## Códigos por e-mail

Seis caracteres de um alfabeto de 31, sem `0/O` e `1/I/L` — 887.503.681
combinações, e há teste de que a conta bate. Mostrados como `K7Q-M2P`; quem
digita pode usar minúscula, espaço e hífen. Validade de 10 minutos, uso único,
5 erros encerram, 60 s entre envios, 5 envios por hora.

**O Redis nunca vê o código.** Guarda o HMAC-SHA256 de `challenge:código` com o
`AUTH_OTP_SECRET`, então o código só vale no navegador que pediu — o
`challenge` vem de um cookie assinado. O script Lua compara HMACs, então medir
o tempo da comparação não diz nada.

Um código que não bate e um código de outro navegador devolvem **a mesma
coisa**. Dizer qual dos dois foi entregaria se existe um código em curso.

### O Lua mora em TypeScript, e não num arquivo `.lua`

O plano chama os scripts de `lua/issue-otp.lua` e `lua/verify-otp.lua`. Aqui
eles são constantes em `src/scripts.ts`. O motivo é que o dashboard é Next.js:
ler um arquivo ao lado do módulo em tempo de execução depende de como o bundler
tratou o caminho, e uma constante não depende de nada. É uma fonte só — não há
`.lua` para alguém editar achando que é o que roda.

O teste de integração do `packages/adapters` carrega uma **cópia** desses dois
scripts, de quando a etapa 2.3 precisou de um payload realista para exercitar o
`eval`. `src/otp.test.ts` compara as duas e falha se divergirem, para ninguém
editar a cópia achando que é a original. É por isso que este pacote tem
`turbo.json` com `cache: false`: ele tem um teste que lê fora do próprio
diretório, que é a única razão aceita por `internal/release/src/turbo.test.ts`.

### Contra Redis de verdade

`src/otp.integration.test.ts` roda os dois scripts no Valkey: uso único, outro
navegador, o quinto erro encerrando, expiração **pela TTL de verdade**, código
novo invalidando o anterior, espera de reenvio e o sexto envio na hora. Pulado
sem Redis; `REDIS_TEST_REQUIRED=1` transforma o pulo em falha, que é o que o CI
faz.

## Access token e refresh token

O access token é um JWT Ed25519 de 10 minutos com `sub`, `sid`, `iss`, `aud`,
`exp` e nada mais. **Papel não vai no token** — é consultado no servidor, para
mudar na hora. Há teste de que `role`, `roles` e `org` não aparecem.

### O `kid` sai da própria chave

É o *thumbprint* RFC 7638 da chave pública. Isso faz a rotação não precisar de
configuração nenhuma: basta a chave nova entrar na lista e a antiga continuar
lá enquanto houver token dela em circulação. `verifyAccessToken` escolhe pelo
`kid` do cabeçalho; sem chave correspondente, recusa sem nem tentar verificar.

A verificação recusa token de outra chave, assinatura trocada, token vencido,
`alg: none` e lixo — sem lançar, em todos os casos.

### Refresh: `{sid}.{segredo}`, e o Redis guarda o hash

O Redis nunca vê o token: guarda o SHA-256 dele em `sess:{sid}`. Há teste de que
nenhum campo do hash contém o token.

A rotação é o `rotate-refresh.lua` do plano, e tem quatro saídas:

| Saída | Quando |
|---|---|
| `rotated` | token atual — vira `prev`, nasce um novo |
| `within-grace` | token anterior, dentro de 30 s — só um access token novo |
| `reused` | token anterior, depois da janela — **a sessão inteira acaba** |
| `unknown` | token que ninguém emitiu — recusa e **não derruba a sessão** |

Esse último é deliberado: derrubar a sessão de quem só conhece o `sid` seria um
jeito de desconectar os outros.

Lembrar o dispositivo dá 7 dias de inatividade e 30 de teto; não lembrar dá 12 h
para os dois. Passar do teto de 30 dias apaga a sessão na própria rotação.

### Contra Redis de verdade

`src/sessions.integration.test.ts` cobre a lista da §11.11: rotação normal,
reuso encerrando a sessão, **dez requisições paralelas** com o mesmo token (todas
`within-grace`, sessão viva), teto de 30 dias, sair de todos os dispositivos sem
tocar na sessão de outra pessoa, e revogação visível na hora — que é o que uma
ação sensível confere.

## O que foi conferido contra a API de verdade

Em 06/11/2026, pelo módulo, sem mock: `password123456` e `qwertyuiop1234`
voltaram `breached`, e uma senha longa aleatória voltou `clean`. Isso é o que
prova o SHA-1, a divisão prefixo/sufixo e a leitura da resposta ao mesmo tempo.
**Não há teste de rede no CI**: um terceiro fora do ar não pode deixar este
repositório vermelho.
