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

## Renovar sem a pessoa perceber

`renewSession` é a §11.4 sem HTTP: recebe os dois cookies e devolve um de quatro
resultados — `carry-on` (o access token ainda vale, e **o Redis não foi
consultado**), `renewed` (access token novo, e um refresh novo quando houve
rotação de verdade), `reused` e `anonymous`.

**O dono do token novo vem da sessão, nunca do token vencido.** O
`rotate-refresh` devolve `{código, userId, remember}` numa tabela Lua, e é esse
`userId` que vira o `sub`. Ler o `sub` do token que acabou de ser recusado
parece inofensivo — a assinatura dele continua válida, afinal — mas seria
confiar num dado que o servidor já tinha decidido não aceitar. Há teste com um
token vencido que diz ser de outra pessoa.

O `remember` passou a ser gravado na sessão porque a renovação precisa saber se
os cookies levam `Max-Age` ou somem ao fechar o navegador. **A TTL da sessão
não precisou dele**: o teto absoluto de uma sessão não lembrada já é 12 h, então
`min(7 dias, absExp - agora)` nunca passa disso. Eu tinha escrito um `if` no Lua
para escolher a inatividade; a sabotagem mostrou que nenhum teste mudava de
resultado com ele removido, porque ele era código morto. Saiu.

## Cadastro

Só por convite. O link traz um token de 32 bytes; o banco guarda o **SHA-256**
dele, então quem lê a tabela não consegue entrar por ninguém.

A ordem importa e tem teste: convite → nome → senha → conta. A política de senha
roda **antes** de qualquer escrita, e o nome em branco é recusado antes de a
consulta ao Pwned Passwords sair.

**O convite não é gasto no cadastro.** A conta nasce sem `email_verified_at`, e
só a confirmação do código marca a conta, gasta o convite e cria a associação —
tudo num `INSERT ... WITH` só, porque o `SqlRunner` não tem transação e três
escritas separadas podem parar no meio. Há teste de que o cadastro não toca em
`email_verified_at` nem em `memberships`.

Fechar a aba no meio não deixa ninguém preso: o cadastro reaproveita uma conta
que existe mas não foi confirmada e manda outro código. Conta **já confirmada**
devolve `account-exists` — não é vazamento, porque quem tem o link do convite já
sabe o endereço.

### As regras do convite vivem em SQL, e agora têm teste

Expirado, revogado, já aceito e endereçado a outra pessoa são todos recusados
por `where` no banco. Isso não aparecia em teste nenhum até a
`src/invites.integration.test.ts`, que roda contra o Postgres de verdade.

Uma coisa que o próprio esquema ensinou: a *check constraint*
`invites_expire_after_they_are_created` impede inserir um convite já vencido, então
o teste precisa criá-lo com `created_at` no passado. O banco recusando o dado
impossível é o banco funcionando.

## A conta depois que ela existe

`src/account.ts` tem as quatro operações da §11.1 e da §11.5, todas sem HTTP.

**Recuperar a senha.** `startRecovery` responde **a mesma coisa** para um
endereço que ninguém tem, para uma conta que nunca confirmou e para uma conta
suspensa; a rota ainda grava um cookie de desafio nos três casos, senão a
*ausência* do cookie já diria que a conta não existe. Só um endereço que não
pode entrar conta como tentativa no rate limit — para um que pode, quem segura é
a espera de 60 s entre envios, que não dá para usar para trancar a conta de
outra pessoa.

**A política da senha roda antes de o código ser gasto.** Se a ordem fosse a
outra, uma senha recusada por ser curta queimaria o código e a pessoa teria de
começar de novo por um erro que o servidor já sabia. Há teste de que o código
ainda vale depois de uma senha recusada — ele pegou a ordem invertida numa
sabotagem.

**Trocar a senha de dentro da conta** pede a senha atual e **encerra todas as
sessões**, inclusive a de quem está trocando. É o que a §11.5 escreve. O efeito
colateral apareceu no teste ponta a ponta e está contado abaixo.

**Trocar o endereço** pede a senha de novo e manda **dois códigos**: um para o
endereço atual e um para o novo, com ids diferentes (`{userId}` e
`{userId}:new`), então um não responde pelo outro — há teste de que trocar os
dois é recusado. O endereço pretendido fica no Redis com a mesma validade do
código, junto do desafio. Essa comparação do desafio é **a segunda fechadura da
mesma porta**: o `verifyCode` já recusa um desafio de outra aba, então o único
teste que a enxerga escreve a chave pendente à mão.

**Sessões ativas.** `listSessions` roda um Lua que lê o conjunto do usuário e,
para cada sid morto (expirado pela TTL ou apagado numa rotação), tira o membro
da lista em vez de mostrá-lo. `revokeOwnSession` **confere o dono dentro do
script** — sem isso, conhecer um `sid` bastaria para desconectar outra pessoa, e
a sabotagem que tirou a comparação foi pega na hora.

## Papéis, organizações e convites

`src/permissions.ts` é a tabela da §10.2 em código, e **`src/permissions.test.ts`
lê a tabela do próprio `docs/PLANO.md`** para conferir as 48 células. Não é um
segundo registro da mesma coisa: se alguém alargar uma permissão aqui sem mexer
no plano, o teste falha nomeando a célula. A sabotagem que deu `alert-channels`
a um `member` foi pega assim.

Duas regras ficam fora da tabela porque são a nota de rodapé dela: `mayActOn`
impede um admin de mexer num owner, e `mayGrant` impede um admin de criar outro
owner.

**Ninguém fica sem owner.** Rebaixar ou remover o último owner é recusado pelo
próprio `where` do `UPDATE`/`DELETE` — não por uma leitura anterior, que duas
requisições simultâneas furariam. `transferOwnership` promove e rebaixa **numa
instrução só**, pelo mesmo motivo.

**O escopo da organização está em toda cláusula `where`.** Trocar um papel,
remover alguém e revogar um convite recebem o id da organização e o id do alvo,
e o alvo de outra organização simplesmente não casa. A sabotagem que tirou o
`organization_id = $1` do `CHANGE_ROLE` quebrou três testes.

Um convite para um endereço que já tem convite aberto **substitui** o anterior,
num `on conflict` sobre o índice parcial do esquema — e o link antigo para de
valer na hora, o que tem teste.

### `$7::jsonb` grava o JSON duas vezes

O metadado do audit log ia como texto e voltava como texto, não como objeto: o
driver vê o `::jsonb` e serializa o parâmetro por conta própria, em cima do
`JSON.stringify` que já estava lá. `$7::text::jsonb` resolve — o parâmetro entra
como texto e o Postgres é quem o lê como JSON.

## Projetos e ambientes

`src/projects.ts` é a seção 6 do plano: a hierarquia organização → projeto →
ambiente, e as configurações de cada ambiente.

**Um projeto nasce com os três ambientes numa instrução só.** `production`,
`staging` e `development` entram num `insert ... select` sobre o `unnest` dos
três ids, dentro da mesma CTE que cria o projeto. Não dá para existir projeto
sem ambiente nenhum, nem por uma requisição que morreu no meio.

**O escopo da organização está em toda instrução, e `projects.test.ts` confere
isso lendo o próprio módulo.** Cada constante SQL ou cita `organization_id` ou
interpola `BELONGS_TO`, que é o fragmento `exists (select 1 from projects ...)`
ligando o ambiente ao projeto e o projeto à organização. O teste também falha
se aparecer interpolação que não seja um desses fragmentos — o resto é
parâmetro. A sabotagem que tirou o `organization_id` do `BELONGS_TO` quebrou
**13 testes**, entre eles o que lê o módulo e nomeia o que faltou.

Isso importa porque o id do ambiente sozinho seria suficiente para vazar: a
rota recebe `/[org]/projects/[project]/environments/[env]`, e nomear a própria
organização com o projeto de outra pessoa é o caminho óbvio. Há teste para esse
caminho exato, no Postgres e no navegador.

**Nenhum projeto fica sem ambiente.** Como no último owner, a recusa está no
`where` do `DELETE`, não numa leitura anterior.

**O limite de retenção aqui é sanidade, não política.** `MAX_RETENTION_DAYS` é
365 porque o ClickHouse leva o número a sério no `TTL` e um valor maior que um
ano é erro de digitação. O teto de 7 dias por organização da instância
hospedada (§15) é da etapa 2.19, onde a coluna existe — este módulo não o
inventa.

### Uma chave que o parser descarta em silêncio

`parseRedactionRules` ignora o que não conhece, então `{"regex": "(a+)+$"}`
voltava `200` com a regra jogada fora. A *check constraint* do esquema nunca
dispararia, porque o que se grava é o objeto já analisado — sem a chave. É a
mesma regra que a API pública já segue: parâmetro desconhecido é recusado, não
ignorado, porque um filtro que não faz nada se lê como um filtro que funciona.
`readEnvironmentSettings` recusa nomeando a chave, e `REDACTION_FIELDS` está
preso aos campos que o parser de fato lê.

### Uma origem que nunca casaria

A allowlist de origens é o que separa uma key pública de qualquer site. Um
padrão com caminho, com credenciais ou com `*.com` é recusado na escrita, em
vez de guardado para nunca casar — ou, no caso do `*.com`, para casar demais.

## Login

`startLogin` e `finishLogin` são o fluxo da §11.1, sem HTTP: quem chama entrega
um `SqlRunner`, um `RedisClient` e o segredo dos códigos.

**Senha errada e endereço que não existe devolvem a mesma coisa**, e demoram o
mesmo: quando não há conta, `spendTheSameTime` gasta uma verificação argon2 de
verdade. E-mail não confirmado e conta suspensa também caem no mesmo `refused` —
dizer qual dos três foi entregaria o estado da conta.

O endereço é sempre normalizado para minúsculas antes da consulta, e há teste de
que o SQL recebe o endereço em minúsculas mesmo quando a pessoa digitou com
maiúscula e espaço em volta.

### Limite de tentativas

Cinco por conta, vinte por endereço, em 15 minutos, com espera crescente de
1 → 2 → 4 → 8 → 15 minutos. A quinta falha **já** bloqueia: é o que a §11.6
quer dizer com "5 senhas erradas ativam uma espera".

Eu errei isso por um na primeira versão, e o teste unitário não pegou porque eu
o escrevi contra o meu código em vez de contra o plano. Quem pegou foi o teste
de integração. A sequência `[0,0,0,0,60,120,240,480,900]` está presa contra
Redis de verdade.

Um login que dá certo esquece as falhas **da conta** e não as do endereço — quem
está varrendo endereços não ganha fôlego acertando uma senha.

### Senha certa dentro da espera de 60 s não é "senha inválida"

Era, até a 2.11. O `startLogin` devolvia `refused` quando o `issueCode` estava
em espera, e a rota traduzia isso para `invalid_credentials` — a pessoa digitava
a senha certa e lia que estava errada. A 2.11 tornou isso frequente, porque
trocar a senha encerra todas as sessões e manda a pessoa entrar de novo **dentro
daquela mesma janela de 60 s**.

Agora é `slow-down` com `Retry-After`, e não conta como falha. Não há vazamento:
só se chega ali **depois** de a senha ter conferido, então dizer "espere" não
conta nada que quem perguntou já não soubesse.

### Cookies

`__Host-at`, `__Host-rt` e `__Host-lc`, todos `HttpOnly`, `Secure`,
`SameSite=Lax`, `Path=/` e sem `Domain` — que é o que o prefixo `__Host-` exige.
O cookie do desafio carrega `{userId}.{challenge}` assinado com HMAC e comparado
em tempo constante; trocar o usuário ou o desafio invalida a assinatura.

Marcar "lembrar este dispositivo" é o que decide se os cookies têm `Max-Age`:
sem ele, somem ao fechar o navegador e a sessão dura no máximo 12 h.

### Turnstile fica atrás da variável

`checkTurnstile` devolve `off` sem tocar a rede quando não há
`TURNSTILE_SECRET_KEY`, e passa a valer assim que a chave existir — sem mudar
código. É o mesmo padrão de `INFRA_ENABLED` e `BACKUPS_ENABLED`.

Quando está ligado ele **falha fechado**: erro de rede, status ruim, resposta
sem `success: true` exato ou requisição sem token são todos `refused`. Essa é a
diferença para o Pwned Passwords, e é deliberada — ali quem paga é quem cria
conta num dia ruim; aqui quem paga é o bot.

## O que foi conferido contra a API de verdade

Em 06/11/2026, pelo módulo, sem mock: `password123456` e `qwertyuiop1234`
voltaram `breached`, e uma senha longa aleatória voltou `clean`. Isso é o que
prova o SHA-1, a divisão prefixo/sufixo e a leitura da resposta ao mesmo tempo.
**Não há teste de rede no CI**: um terceiro fora do ar não pode deixar este
repositório vermelho.
