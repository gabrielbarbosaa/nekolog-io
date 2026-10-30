# ADR 0007 — Autenticação própria, sem Better Auth

- **Status:** aceita
- **Data:** 2026-10-29
- **Plano:** seções 1 e 11

## Contexto

O dashboard precisa de autenticação com dois requisitos que foram definidos como
não negociáveis:

1. **Refresh token com rotação e detecção de reuso** — a cada renovação o token
   muda, e se um token já usado reaparecer, a sessão inteira cai (sinal de token
   copiado).
2. **Segundo fator obrigatório em todo login**, com código **alfanumérico de 6
   caracteres** enviado por e-mail — não TOTP, não código numérico.

O Better Auth foi avaliado como a opção pronta mais moderna do ecossistema
TypeScript. Ele não atende nenhum dos dois: não implementa rotação de refresh
token com detecção de reuso, e o plugin de 2FA gera código numérico ou TOTP.

Escrever autenticação à mão é reconhecidamente uma das piores ideias em
segurança de aplicação. A decisão só se justifica se os requisitos realmente não
couberem em nada pronto, e se vier acompanhada de disciplina de teste.

## Decisão

Módulo próprio em `internal/auth`, construído sobre bibliotecas estabelecidas
para as partes criptográficas — nada de primitiva implementada à mão:

- `@node-rs/argon2` para hash de senha (argon2id, 19 MiB, 2 iterações).
- `jose` para JWT Ed25519.
- Redis para códigos e sessões, com a lógica crítica em **scripts Lua**, para
  que emissão de código, verificação e rotação de token sejam atômicas.
- API do Pwned Passwords (k-anonymity) para recusar senha vazada.

As rotas em `apps/auth` são finas e só chamam o módulo.

Com a separação open-core (ADR [0002](0002-open-core-com-dashboard-fechado.md)),
`internal/auth` passa a viver no repositório privado `nekolog-dashboard`.

## Consequências

- **O projeto assume o risco de uma classe inteira de vulnerabilidade.**
  Enumeração de usuário, timing attack, fixação de sessão, race em renovação de
  token — tudo isso vira responsabilidade do código daqui.
- **Por isso a seção 11.11 do plano existe.** Os testes não são opcionais:
  código expirado, reutilizado, 6ª tentativa, outro navegador, 10 requests
  paralelas com o mesmo refresh token, limite de 30 dias, revogação em ação
  sensível. Os scripts Lua rodam contra um Redis de verdade no CI.
- **Checklist OWASP ASVS nível 2** para autenticação, sessão e controle de
  acesso, e revisão de segurança dedicada do `internal/auth` antes da demo
  pública.
- **A lógica concorrente fica em Lua, não em TypeScript.** Verificar um código e
  incrementar tentativas precisa ser uma operação atômica — fazer isso em duas
  chamadas ao Redis abre janela de corrida. Isso significa manter e versionar
  Lua, carregado por `EVALSHA`.
- **Nada de login social.** Não está no escopo; adicionar OAuth depois é
  trabalho novo, não configuração.
- **Manutenção é por conta do projeto.** Uma vulnerabilidade descoberta numa
  biblioteca pronta chega por atualização; aqui, chega só se alguém perceber.

## Alternativas consideradas

- **Better Auth.** Avaliado em detalhe e descartado pelos dois requisitos acima.
  Seria a escolha padrão se eles fossem flexíveis.
- **Lucia.** Foi descontinuada como biblioteca, virando um guia de
  implementação — ou seja, a recomendação do próprio projeto passou a ser
  escrever à mão.
- **Auth0, Clerk, WorkOS.** Resolvem tudo, inclusive os requisitos.
  Descartados pela restrição de custo (ADR [0003](0003-so-servicos-gratuitos.md)):
  os planos gratuitos são limitados e o modelo de preço cresce por usuário ativo.
- **NextAuth / Auth.js.** Modelo de sessão não contempla rotação de refresh
  token com detecção de reuso sem reescrever a camada de adapter — ou seja,
  acabaria em código próprio de qualquer forma, só que preso à API deles.
- **Afrouxar os requisitos para caber numa biblioteca pronta.** Era a saída
  mais segura. Descartada porque rotação com detecção de reuso é precisamente o
  que se quer estudar e demonstrar neste projeto.
