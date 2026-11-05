---
title: O que fica guardado
description: O que uma linha de log carrega, o que é removido antes de sair do seu processo, o que é removido no servidor, e o que nunca é gravado.
---

Log é a coisa mais sensível que esta plataforma guarda, porque as pessoas põem
coisa lá dentro sem querer. Esta página é o que o código faz a respeito — o
texto jurídico está em [/legal/privacy](https://nekolog.io/legal/privacy).

## O endereço IP nunca é gravado

Nem com hash, nem truncado, nem por um tempinho. A linha é montada só com o
**país**, lido do `CF-IPCountry` e validado como dois caracteres. Nenhum header
de IP é consultado em lugar nenhum do caminho, e tem teste que manda
`CF-Connecting-IP` e `X-Forwarded-For` e falha se a linha gravada contiver
qualquer um dos endereços.

## Removido antes de sair do seu processo

O SDK tira dado sensível **dentro da sua aplicação**, então ele nunca chega na
rede:

- **por chave**: `password`, `token`, `authorization`, `secret`, `cpf`, campos de
  cartão e mais, em qualquer profundidade;
- **por valor no texto**: um par `chave=valor` com chave sensível, número de
  cartão que passa no Luhn, CPF com dígito verificador válido, JWT, credenciais
  `Bearer` e `Basic`, credencial dentro de URL, e key do NekoLog.

Isso roda **depois** do seu gancho `beforeSend`, então um gancho não desfaz.

Mais dois padrões que valem saber: o `page.url` descarta a query string e o
fragmento, porque token de redefinição e código de convite moram ali; e um
breadcrumb de clique registra `button#pay` — o seletor — e **nunca** o texto nem
o valor do elemento, porque um rótulo pode nomear uma pessoa.

## Removido de novo no servidor

Cada ambiente pode ligar padrões nomeados, aplicados na ingestão **antes da
linha ser gravada**: e-mail, IPv4, IPv6, telefone brasileiro, CPF, CNPJ, JWT,
`Bearer`, UUID e cartão de crédito. Atributos podem ser apagados por chave exata
ou por prefixo.

Você **não** fornece expressão regular. A coluna aceita nomes de uma lista
fechada, e uma check constraint recusa um rótulo chamado `regex`, `pattern` ou
`patternSource`. Isso não é burocracia: um regex de terceiro no caminho quente de
um Worker com 10 ms de CPU é negação de serviço que você escreve para si mesmo.

Se a regra guardada não puder ser lida, a ingestão **aplica todos os padrões** em
vez de nenhum. Um controle de privacidade que silenciosamente deixa de funcionar
é pior que um que redige demais.

## Por quanto tempo fica

A retenção é por ambiente, e é imposta pelo relógio do **servidor**, não pelo
seu. O `timestamp` gravado é limitado a
`[received_at − (retenção − 1h), received_at + 5min]`, e a diferença real vai
para `clock_skew_ms`, então o horário que você mandou é sempre
`received_at − clock_skew_ms`.

Esse limite existe porque a tabela particiona e expira por essa coluna. Um
relógio em 2099 gravaria numa partição que nenhuma consulta por período alcança
e cujo vencimento só chega em 2099; um relógio atrasado além da retenção faz a
linha **sumir no insert**, sem nada ser avisado. Os cinco minutos de folga para
frente deixam a deriva normal de NTP em paz.

## O que você pode escolher não mandar

| | |
|---|---|
| Nível mínimo | por ambiente, imposto na ingestão |
| Amostragem | por ambiente, uma taxa entre 0 e 1 |

A amostragem é semeada no id do trace, depois no id da sessão, então **um trace
inteiro é mantido ou descartado junto** — meio trace não serve para ninguém
investigando. **`error` e `fatal` nunca são amostrados para fora**, seja qual for
a taxa: uma taxa baixa para controlar volume deve cortar o ruído, não o sinal.

Uma configuração que não faz sentido — nível desconhecido, taxa zero ou acima de
um — volta a deixar tudo passar, em vez de descartar seus logs em silêncio.

## Onde cada coisa fica

| | |
|---|---|
| Linhas de log | ClickHouse |
| Projetos, keys, issues, alertas | Postgres, e só o hash SHA-256 da key, nunca a key |
| Source maps e exportações | um armazenamento de objetos |

Um link de exportação leva ao dashboard, nunca ao arquivo, e o bucket apaga em
sete dias. Um source map nunca é servido de volta pela API pública: não existe
rota que leia um.
