# Lançamento

O texto do anúncio da 1.0, pronto para publicar. Fica no repositório porque é
conteúdo que afirma coisas sobre o código, e conteúdo assim envelhece junto com
ele: se um número aqui deixar de ser verdade, o lugar de corrigir é o mesmo PR
que mudou o número.

| Arquivo | Onde vai |
|---|---|
| [post.en.md](post.en.md) | dev.to e, com o corte indicado no final, o Show HN |
| [post.pt-BR.md](post.pt-BR.md) | TabNews |

**Não há versão em espanhol.** A regra de três idiomas deste repositório vale
para o que uma pessoa lê para usar o projeto — site, documentação, README,
e-mails — e um post de lançamento não é isso: ele é escrito para um público
específico, num site específico. Os dois sites que vão receber esse texto são
em inglês e em português. Um terceiro texto sem destino seria peso morto que
alguém teria que manter.

## Antes de publicar

A ordem importa, porque cada item depende do anterior:

1. **O domínio precisa responder.** Os dois textos apontam para
   `nekolog.io/docs` e `github.com/gabrielbarbosaa/nekolog-io`. O repositório
   existe; o site não, até a infraestrutura ser aplicada.
2. **Decidir o que fazer sobre o npm.** Os textos dizem, nas primeiras linhas,
   que nada foi publicado. Se os pacotes saírem antes do post, as duas frases
   que dizem isso precisam cair — e o `README` e a página
   [Versionamento e suporte](https://nekolog.io/docs/pt-br/reference/versioning/)
   dizem a mesma coisa e precisam cair juntas.
3. **A demo pública é do outro repositório.** Ela é uma sessão somente leitura
   no dashboard, que é fechado; nenhum dos dois textos promete uma.

## O que eles não prometem

De propósito, e vale manter assim numa revisão: não há serviço hospedado, não há
conta para criar, não há plano pago, e o SDK de navegador **não** cumpre a meta
de 5 kB. O texto diz os três. Um post de lançamento que esconde o que não está
pronto compra uma primeira página de comentários e perde a segunda.
