---
title: Versionamento e suporte
description: O que carrega versão, o que uma mudança nela promete, e por quanto tempo uma versão antiga continua funcionando.
---

:::caution[A 1.0 está cortada, nada foi distribuído ainda]
Todo pacote está em `1.0.0` e nenhum chegou ao registro ainda. As promessas
abaixo são as que valem a partir da 1.0, e valem desde a primeira versão que
você conseguir instalar.
:::

## O que carrega versão

| O quê | Como |
|---|---|
| Pacotes npm (`@nekolog-io/*`) | SemVer, com changelog por pacote |
| Apps (`web`, `ingest`, `api`, `jobs`) | o mesmo processo de release; a versão aparece no `/health` |
| A API HTTP | no caminho (`/v1`) |
| O payload de ingestão | o campo `schemaVersion` |
| Bancos de dados | migrations numeradas, nunca editadas depois do merge |
| Documentação | uma versão por major |
| Releases | uma tag e um GitHub Release, com notas e SBOM |

## O que uma mudança promete

**A API HTTP.** Uma mudança incompatível vira `/v2`, e a `/v1` continua
respondendo por pelo menos seis meses. Acrescentar um campo numa resposta não é
incompatível, então leia o que você precisa e ignore o resto.

**O payload.** O servidor aceita os **dois `schemaVersion` mais recentes**, que
é o que permite a um SDK numa aplicação que ninguém redeployou continuar
mandando enquanto um mais novo já saiu.

**Pacotes.** SemVer, com a leitura de sempre: patch corrige, minor acrescenta,
major pode quebrar. Qualquer coisa sendo removida ganha aviso no console e
entrada no changelog **pelo menos uma minor antes** de sair.

**Migrations são só para frente.** Uma migration já mergeada nunca é editada — o
runner tira checksum de cada uma e recusa subir se um arquivo já aplicado mudou,
se há buraco na numeração, ou se o banco lembra de uma que o repositório não tem
mais.

## Por quanto tempo uma versão antiga funciona

| | |
|---|---|
| Major atual | tudo |
| Major anterior | correções de segurança, por seis meses depois da nova |
| `/v1` depois da `/v2` | pelo menos seis meses |
| `schemaVersion` anterior | aceito enquanto for um dos dois últimos |

## Em que isso roda

| | |
|---|---|
| Node | 22 ou mais novo |
| Bun, Deno | atuais |
| Navegadores | Baseline widely available |

Node 22, 24 e 26, Bun, Deno, Chromium, Firefox e WebKit rodam a suíte de testes
em todo pull request — contra o pacote **construído**, não contra o fonte,
porque é isso que você instala.

## Por que a sua versão importa para nós

Um SDK roda dentro da sua aplicação. Isso molda duas regras em volta das quais o
código é escrito, e que nenhuma versão vai mudar:

- **O SDK nunca estoura para dentro do seu app.** Uma biblioteca de log que
  derruba um serviço falhou na sua única tarefa.
- **O `@nekolog-io/core` tem zero dependências de runtime**, por contrato. Os
  limites de que ele precisa são duplicados de propósito em vez de importados, e
  um teste compara um por um contra o parser de verdade para as cópias não
  divergirem.
