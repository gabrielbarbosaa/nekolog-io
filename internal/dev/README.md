# @internal/dev

O que faz `pnpm dev` funcionar numa máquina nova, e o que diz o que está errado
quando não funciona.

```bash
pnpm dev          # escreve o .env, sobe os containers, espera, migra e roda tudo
pnpm dev:doctor   # diz o que falta, item por item
```

## `pnpm dev:env` escreve o `.env`

Copia o `.env.example` e **mantém tudo que você já tinha posto**, como o
`nekolog init` e o `first-run` do self-host. A diferença é que ele também
**substitui o que é claramente um espaço reservado**: qualquer valor que comece
com `dev-only-fake` é trocado por um de verdade.

São cinco: `AUTH_JWT_PRIVATE_KEY`, `AUTH_JWT_PUBLIC_KEY`, `AUTH_OTP_SECRET`,
`ENCRYPTION_KEY` e `NEKOLOG_SELF_KEY`. Os dois primeiros são um par Ed25519 de
verdade, gerado com o `node:crypto`, escrito numa linha só com `\n` escapado —
que é exatamente o que o `apps/dashboard/lib/keys.ts` desescapa. **Sem isso
ninguém entra**: o `.env.example` vinha com `dev-only-fake-ed25519-private-key`,
que não é um PEM, e o `loadSigningKey` quebrava na primeira tentativa de login.

Rodar duas vezes não gera nada de novo, e há teste para isso.

## `pnpm dev:doctor` diz o que falta

Confere o ambiente, os containers, o estado e os aplicativos, e cada linha diz o
que fazer. Três coisas que ele pega e que custaram tempo real:

- **`APP_URL` apontando para a landing page.** O `.env.example` dizia
  `:3000`, que é o `apps/web`; o dashboard é o `:3001`. O `proxy.ts` compara o
  `Origin` de tudo que escreve contra o `APP_URL`, então todo formulário do
  dashboard voltava `bad_origin`.
- **Um container do self-host segurando a porta.** As duas pilhas querem 8787,
  8788 e 8789. Como todo app responde a própria versão no `/health`, o doctor
  distingue o processo que você acabou de subir (`version: "dev"`) de um
  container velho, e diz como derrubá-lo.
- **Um PEM que não é um PEM.** A checagem lê a chave como o dashboard lê.

## O que estava quebrado além disso

- **Turnstile ligado sem widget.** O `.env.example` trazia o par de teste da
  Cloudflare. A chave secreta liga a verificação, e nada em dev desenha o
  widget, então cadastro, login e recuperação respondiam `challenge_failed`.
  Agora vem vazia, com o par anotado em comentário.
- **`EMAIL_ALLOWLIST` vazia.** Fora de `prod`, lista vazia **não libera
  ninguém** — é a regra, e está certa. Mas em dev o e-mail vai para o Mailpit e
  nunca sai da máquina, então a lista vazia só impedia você de receber o código
  e terminar o cadastro. O `pnpm seed invite` avisa quando o endereço que você
  está convidando não está na lista.
- **`KV_DIR` relativo.** Cada app resolvia contra o próprio diretório, então o
  `key-sync` dos jobs publicava 41 keys em `apps/jobs/.nekolog-dev/kv` enquanto
  a ingestão lia `apps/ingest/.nekolog-dev/kv`. As entradas de `serve.ts`
  resolvem contra a raiz do repositório agora, e um teste cobra isso nas duas.
- **A ingestão local não lia o KV.** `pnpm --filter @apps/ingest serve` usava só
  as keys do arquivo de seed, então uma key criada no dashboard nunca
  funcionava. Com `KV_DIR` definido ela agora consulta o KV primeiro e o seed
  depois, igual ao self-host.
