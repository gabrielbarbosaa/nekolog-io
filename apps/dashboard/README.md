# @apps/dashboard

O dashboard. Next.js 16 (App Router), Tailwind v4, tema Grafite, três idiomas.

```bash
pnpm --filter @apps/dashboard dev     # :3001
pnpm --filter @apps/dashboard build
pnpm --filter @apps/dashboard test
```

Nasceu aqui na ADR [0019](../../docs/adr/0019-um-repositorio-so.md). Até
06/11/2026 ele seria um repositório separado; a divisão existia porque este era
público sob MIT, e isso acabou.

## O que já está ligado

Tema (claro, escuro, do sistema), idioma (`en`, `pt-BR`, `es` por cookie
`NEKOLOG_LOCALE`, sem prefixo na URL), cabeçalhos de segurança com nonce por
resposta, e `/health`. As telas chegam uma etapa por vez, a partir da 2.5.

A página inicial é a moldura com um texto honesto sobre o que falta. Ela sai na
2.17, quando o Explorer entra — foi o que o `apps/web` fez até a 6.8.

## As rotas de login

`app/api/auth/login/{start,verify,resend}`. São finas: validam a origem, leem o
corpo e chamam o [`@internal/auth`](../../internal/auth/README.md).

`tests/auth-routes.test.ts` lê o fonte de toda rota POST sob `app/api/` e falha
se alguma deixar de checar `Origin`, de rodar em `nodejs`, de ser
`force-dynamic`, se registrar no log um identificador que carrega senha, código,
token ou desafio, ou se o `login/start` parar de chamar o `checkTurnstile`. Essa
última é o que garante que ligar o Turnstile seja só uma variável de ambiente.

O e-mail do código sai **depois da resposta**, pelo `after()` do Next: o tempo da
resposta não pode dizer se a senha estava certa.

### `__Host-` em desenvolvimento

Os cookies exigem `Secure`, o que normalmente significa HTTPS. Chrome e Firefox
tratam `http://localhost` como contexto seguro, então o login funciona em
`:3001` sem certificado. Em qualquer outro host sem HTTPS, não funciona — e isso
é o prefixo fazendo o trabalho dele.

## As rotas da conta

`password/{forgot,reset,change}`, `email/{change,confirm}`, `sessions` (listar e
encerrar uma) e `logout-all`. As cinco que só valem para quem está dentro
chamam o `liveSession(request)`, que confere o JWT **e** pergunta ao Redis se a
sessão ainda existe — é a "ação sensível" da §11.5, e é o que faz uma sessão
revogada ser barrada na hora em vez de nos próximos dez minutos.

`tests/auth-routes.test.ts` falha se uma delas parar de chamá-lo, mas esse teste
lê o fonte: ele **não** viu a sabotagem que deixou o `liveSession` devolver a
sessão sem perguntar ao Redis, porque a chamada continuava lá. Quem viu foi o
teste ponta a ponta.

Nenhuma delas lê o id da conta do corpo da requisição — só do token verificado —
e há teste disso também.

### Conferido ponta a ponta

Em 06/11/2026, contra o stack de dev (Postgres, Valkey e Mailpit de verdade):
origem estranha recusada, senha errada e endereço inexistente com a mesma
resposta, código chegando no Mailpit no idioma da conta, código errado recusado,
código certo devolvendo `__Host-at` e `__Host-rt`, e o mesmo código recusado na
segunda vez. **14 de 14.**

Foi assim que apareceu um defeito que nenhum teste unitário pegou: o
user-agent real `(X11; Linux x86_64)` vira `Firefox on Linux x86_64`, e o
allowlist do campo "navegador" do e-mail não aceitava `_` — o e-mail dizia
`unknown` para um navegador perfeitamente normal.

Em 06/11/2026, de novo, agora com as rotas da conta: **38 de 38**, com Postgres,
Valkey e Mailpit de verdade. Cobre cadastro, confirmação, entrada, lista de
sessões, troca de senha (com o aviso por e-mail e todas as sessões caindo),
troca de endereço com os dois códigos, recuperação de senha, sair de todos os
dispositivos, origem estranha recusada, encerrar a sessão de outra pessoa
recusada, e a sessão revogada barrada na hora com o access token ainda válido.

Dois defeitos saíram daí. Um é do produto: trocar a senha encerra todas as
sessões e manda entrar de novo **dentro** da espera de 60 s entre códigos, e o
login respondia "e-mail ou senha inválidos" a quem tinha acabado de digitar a
senha certa; agora responde 429 com `Retry-After`. O outro é do arnês: o
`DELETE /api/v1/message/{id}` do Mailpit não apaga nada (o certo é
`DELETE /api/v1/messages` com os ids no corpo), então o script lia um código
velho e culpava o servidor.

## O `proxy.ts`

Ele faz três coisas, nesta ordem: monta o nonce e os cabeçalhos, recusa um
método que escreve vindo de outra origem, e renova a sessão.

**A renovação não custa nada quando não precisa acontecer.** Com um access token
válido, a verificação é da assinatura e mais nada — o Redis não é consultado. Só
quando o token venceu (ou sumiu) e sobrou o `__Host-rt` é que o `renewSession`
roda a rotação. Sem `__Host-rt` o Redis nem é aberto: o `lib/redis.ts` usa
`lazyConnect`, então uma visita anônima não abre socket nenhum.

Ao renovar, os cookies novos vão na resposta **e** o cabeçalho `cookie` da
request que segue adiante é reescrito, senão os Server Components daquela mesma
request ainda leriam o token velho. Há teste disso nos dois sentidos.

**Nenhum header que o proxy repassa é confiável.** Ele não escreve `x-user-id`
nem nada parecido; quem precisa da sessão chama o `lib/session.ts`, que verifica
o JWT de novo.

**Se o Redis cair, a renovação lança** em vez de tratar a pessoa como
desconectada. É a mesma regra do resto do repositório: "não consegui medir" não é
"não existe". A tela de entrar não é afetada, porque quem não tem cookie nenhum
nunca chega a consultar o Redis.

A checagem de `Origin` vale para `POST`, `PUT`, `PATCH` e `DELETE`, compara com
a `APP_URL` (e, sem ela, com a origem da própria request — nunca libera por
falta de configuração) e deixa `/health` de fora, que é por onde o container é
vigiado.

### Limpar um cookie `__Host-` não é `cookies.delete`

O `delete` do Next escreve o cookie vencido **sem** `Secure` e sem `Path=/`, e o
navegador recusa isso num nome com prefixo `__Host-` — o cookie continua lá.
`lib/cookies.ts` tem o `clearCookie`, que escreve `Max-Age=0` com os atributos
que o prefixo exige, e `tests/cookies.test.ts` falha se eles sumirem. As rotas
de confirmação já faziam o `delete`; foram corrigidas junto.

### Rotação da chave do JWT

`verifyingKeys()` lê a `AUTH_JWT_PUBLIC_KEY` e a `AUTH_JWT_PREVIOUS_PUBLIC_KEY`,
nesta ordem, e aceita token das duas enquanto a troca estiver em curso — o `kid`
é o thumbprint da própria chave, então não há nada a configurar. Cada variável
pode trazer mais de um bloco PEM, e `\n` escapado vira quebra de linha, que é
como um `.env` carrega uma chave.

## Cinco regras de desenho

Não são preferências: cada uma corrige algo que os mockups da 2.1 erraram, e a
skill `frontend-design` nomeia três delas como marcas de página gerada.

**Cor significa nível ou ambiente. O chrome é acromático.** Num leitor de logs a
cor pertence ao dado — `--level-*` e `--env-*`. Botão primário, item de navegação
ativo e foco usam o neutro. Se algo colorido não é um nível nem um ambiente, está
errado.

**Mono significa "isto alinha com a linha de baixo".** Timestamp, id, nível,
trecho de código e a linguagem de busca. **Nunca um rótulo**: mono em rótulo
pequeno é decoração, e a skill lista isso como marca.

**Uma borda é uma fronteira, não um grupo.** Entre navegação e conteúdo, entre a
barra e os resultados, em volta de um painel que é outra superfície. Não em volta
de cada conjunto de campos — foi o que transformou os mockups num tabuleiro de
cards idênticos.

**A consulta é um objeto só.** Ambiente, período e busca ficam juntos, numa barra
só, logo acima do que eles filtram. Os mockups espalharam os três em três
lugares; são três partes do mesmo ato.

**Densidade é recurso.** A escala tipográfica é fechada — `text-data` (13px) é o
corpo *e* a linha de log. Uma barra, não duas. Sem rótulo em caixa alta, sem
`A · B · C`.

## A armadilha do `cn()`

`text-data`, `text-aside`, `text-section` e `text-screen` são tamanhos, e o
`tailwind-merge` não conhece token customizado: sem configuração ele os
classifica como **cor** e descarta `text-muted-foreground` como conflito. O
rótulo some da tela e nada avisa.

`lib/utils.ts` estende o merge com esses quatro, e `lib/utils.test.ts` falha nos
dois sentidos: se um tamanho e uma cor pararem de conviver, e se a lista do merge
divergir dos `--text-*` que o `globals.css` declara.

## O tema não é uma cópia solta

`app/globals.css` começa com o conteúdo literal de
[`docs/tema/globals.css`](../../docs/tema/globals.css) e só então acrescenta a
escala tipográfica. `apps/web/tests/theme.test.ts` compara os blocos `:root` e
`.dark` de toda cópia com o arquivo canônico e falha nos dois sentidos — mude a
cor lá, não aqui.

## Testes

`i18n/messages.test.ts` falha se uma chave some, fica em branco, continua em
inglês, ou se um valor grita em caixa alta. A lista de exceções só aceita
substantivo de produto e a linguagem de busca, com teste de que ninguém põe uma
frase nela.

`tests/headers.integration.test.ts` sobe o servidor de produção de verdade e
confere cabeçalho, nonce por resposta, todo `<script>` alcançado pelo nonce, e
que **nenhum atributo `style`** apareça — nonce não alcança atributo de estilo.
Ele é pulado sem build; `DASHBOARD_HEADERS_TEST_REQUIRED=1` transforma o pulo em
falha, que é o que o CI faz.
