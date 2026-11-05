# NekoLog 1.0: uma plataforma de log que eu construí para descobrir o que quebra

Passei os últimos meses construindo uma plataforma de log para aplicações
JavaScript e TypeScript, de ponta a ponta: os SDKs, a API de ingestão, o
armazenamento, os jobs em segundo plano, os alertas, a API pública de leitura e
a documentação. Hoje ela está na 1.0 e o código é MIT.

Duas coisas antes de tudo, porque elas mudam como você lê o resto.

**Nada foi publicado no npm e não existe serviço hospedado.** Não há conta para
criar. O workflow de publicação está pronto e espera uma variável de repositório
que não existe; a infraestrutura está escrita em OpenTofu e nunca foi aplicada.
O que dá para fazer hoje é rodar tudo por conta própria:

```bash
git clone https://github.com/gabrielbarbosaa/nekolog-io
cd nekolog-io/deploy/self-host
./up.sh
```

**O dashboard é fechado.** É open-core, e a linha está nas telas. Tudo que
encosta nos seus dados — os SDKs, a ingestão, a remoção de dado sensível, o
armazenamento, os alertas, a API de leitura — é aberto e auditável. O dashboard
não é, e o self-host não inclui ele. Prefiro dizer isso no primeiro parágrafo a
você descobrir no nono.

## O que é

Os SDKs juntam em lote o que a sua aplicação já escreve e mandam por HTTPS. Um
app Hono em Cloudflare Workers valida, tira o que não devia ter saído do seu
processo, calcula o fingerprint dos erros e grava no ClickHouse. Um Worker de
cron acorda a cada minuto para avaliar alertas, agrupar erros em issues, aplicar
cotas e rodar exportações. Uma API de leitura responde busca, histograma e
issues por HTTP.

Doze SDKs sobre um núcleo só: navegador, Node, React, Next, Express, Fastify,
Hono, NestJS, pontes para pino e winston, uma CLI e um plugin de bundler. Se
você já roda OpenTelemetry não precisa de nenhum deles — o
`POST /v1/otlp/logs` aceita OTLP/HTTP e converte antes de qualquer outra coisa,
então um registro OTLP passa exatamente pela mesma validação e remoção de dado
sensível que um nativo.

A coisa inteira foi desenhada para caber em plano gratuito: Cloudflare Workers,
KV e R2, uma VM Always Free da Oracle para o ClickHouse, Neon, Upstash, Vercel,
Resend. O único custo é o domínio.

## As partes que valem a leitura

Nada do que vem abaixo saiu de pensar. Tudo saiu de rodar a coisa e depois olhar
o que de fato aconteceu, que acabou sendo o único método que funcionou.

### Um Worker gratuito da Cloudflare dá 10 ms de CPU, e teste de carga não vê isso

Rodei k6 contra a ingestão e os números estavam bons. Latência boa, vazão boa,
zero erro. Aí medi CPU direto, porque teste de carga mede quanto tempo uma
requisição leva vista de fora, e o limite do Worker é quanto de CPU ela queima
por dentro.

O maior lote que o protocolo permite — 500 eventos, 20% deles erro, com gzip,
todas as regras de remoção ligadas — custava **10,8 ms** contra um limite de
10 ms. Não cabia, e nada no teste de carga disse isso.

Duas mudanças. O fingerprint do erro agora é memoizado por lote, com chave no
texto exato que vai virar hash, então uma rajada de um erro repetido custa um
SHA-256 em vez de cem — e o mapa vive por um lote, nunca globalmente, porque um
isolate de vida longa guardaria um que só cresce. E o lote padrão do cliente
caiu de 500 para 200 eventos; o protocolo continua permitindo 500, mas o cliente
padrão não manda mais o pior caso sem ninguém ter escolhido isso. Depois:
9,1 ms para 500 e 2,1 ms para 200.

Eu deliberadamente não otimizei a remoção de dado sensível, que é o segundo
maior custo. Toda otimização plausível ali é uma heurística que pula valores, e
um controle de privacidade que silenciosamente para de remover é pior que um que
remove demais.

### E então o mesmo teste de carga não mediu nada

A primeira rodada de verdade aceitou **259.600 eventos**. Contei as linhas no
ClickHouse: **200**.

O ClickHouse deduplica inserts por um token, e aqui o token é
`<environmentId>:<batchId>`. Meu script de k6 estava reenviando um fixture só,
então toda iteração depois da primeira foi corretamente descartada como repetida.
A ingestão estava certa e o teste é que estava errado. Agora o script gera um id
de lote por iteração.

Essa me custou uma tarde e me ensinou a regra que eu aplico em todo lugar agora:
uma rodada de carga que não conta as linhas depois não mediu nada. O relatório
disse sucesso. A tabela disse outra coisa.

### Uma expressão regular é uma negação de serviço que você escreve sozinho

A remoção de dado sensível no servidor deixa cada ambiente ligar padrões
nomeados — e-mail, IPv4, CPF, JWT, `Bearer`, cartão de crédito. Nomeados, de uma
lista fechada. Você não pode mandar a sua própria regex, e uma constraint no
banco recusa uma regra cuja chave se chame `regex` ou `pattern`.

Isso não é burocracia, e eu sei porque fui eu que escrevi a regex ruim. O
primeiro padrão de e-mail levou **266 ms** sobre 16 KB de `1-1-1-1-…`, porque o
`[A-Za-z0-9._%+-]+@` refaz a corrida inteira a partir de cada posição inicial.
Com um orçamento de 10 ms, isso é a ingestão parando. Limitar a parte local a 64
caracteres — que é o limite da própria RFC 5321, então não custa nada de
verdade — levou para 9,2 ms, e os dez padrões juntos hoje custam 5,8 ms na pior
forma que eu consegui construir.

Deixar um cliente colar uma regex nesse caminho teria sido entregar a ele um
botão que para a plataforma.

### Um inteiro de 64 bits não cabe num number do JavaScript

Fingerprint de erro é `UInt64`. Rodar o stack produziu `9798706835935588000`
onde a linha tinha `9798706835935588174`: o ClickHouse respondeu com um número
sem aspas e o `JSON.parse` arredondou. Todo leitor neste código é JavaScript,
então o `output_format_json_quote_64bit_integers` agora é o padrão na leitura, e
quem realmente quer um número pede.

Só sei disso porque fui ler. Nada falhou; um dígito mudou.

### O SDK de navegador não cumpre o próprio orçamento de tamanho, e isso está escrito

A meta era 5 kB com gzip. O `init` está em **12,05 kB**; só o `createLogger` em
**9,4 kB**. O `@nekolog-io/core` é 74% disso e já é tree-shaken — 40 kB de fonte
viram 17,5 kB no bundle — e o que sobra é o filtro de privacidade: o Luhn, o
dígito do CPF, o achatamento de atributos, o retry com backoff, a amostragem.

Chegar a 5 kB significaria cortar o filtro de privacidade, que é requisito e não
funcionalidade. Então a meta está não cumprida, o `size-limit` segura os números
onde estão para não crescerem sozinhos, e a falha está escrita no plano com a
medição do lado. Arredondar isso para longe teria sido o caminho fácil e
desonesto.

### A máquina de release nunca tinha rodado

Cortar a 1.0 foi a primeira vez que o `changeset version` rodou neste
repositório. Ele falhou no primeiro comando: o Changesets trata pacote privado
como ignorado e recusa um changeset que nomeie um ignorado e um não-ignorado
juntos — que é o que a maioria dos meus fazia, porque uma feature normalmente
toca um pacote e um app. Eram 68 changesets acumulados desde o primeiro commit,
e a primeira release de verdade teria parado no primeiro comando.

Todo pacote agora também sai com um inventário CycloneDX construído do lockfile
e anexado à Release dele, o que transformou uma promessa numa verificação: o
`core`, a `cli` e o `adapters` declaram zero dependências de runtime, e até
agora isso vivia só na prosa. O lockfile responde, e uma dependência transitiva
chegando por um pacote que eles já usam falha a release.

A publicação em si usa trusted publishing do npm, então não existe token no
repositório nem nos secrets para vazar.

## O que ele faz com os seus dados

O endereço IP nunca é gravado — nem com hash, nem truncado. A linha carrega o
país, e um teste manda `CF-Connecting-IP` e `X-Forwarded-For` e falha se algum
dos dois chegar ao armazenamento.

Dado sensível sai de dentro do seu processo, antes da chamada de rede, por chave
e por valor dentro do texto, e essa passada roda **depois** do seu próprio
`beforeSend`, então o hook não tem como desfazer. Depois de novo no servidor, a
partir da lista fechada acima. Um breadcrumb de clique registra `button#pay` — o
seletor — nunca o texto do elemento, porque um rótulo pode nomear uma pessoa. A
`page.url` perde a query string, porque é lá que moram token de recuperação de
senha e código de convite.

## O que ele não é

É um projeto de portfólio. Um mantenedor, construído contra um plano escrito,
com cada decisão de arquitetura registrada como ADR, incluindo as que foram
revertidas depois. Não é um produto, não tem empresa atrás e eu não estou
pedindo o seu e-mail.

Se quiser olhar: o
[plano](https://github.com/gabrielbarbosaa/nekolog-io/blob/main/docs/PLANO.md) é
o quê e o porquê, as
[etapas](https://github.com/gabrielbarbosaa/nekolog-io/blob/main/docs/ETAPAS.md)
são a ordem em que foi construído — uma etapa, uma branch, um pull request — e o
[modelo de ameaças](https://github.com/gabrielbarbosaa/nekolog-io/blob/main/docs/security/threat-model.md)
registra o que foi aceito sem mitigação completa, e por quê.

**Código:** https://github.com/gabrielbarbosaa/nekolog-io
**Documentação:** https://nekolog.io/docs/pt-br/
