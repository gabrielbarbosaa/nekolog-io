import type { LegalDocument } from '../document'

export const privacy: LegalDocument = {
  id: 'privacy',
  title: 'Política de privacidade',
  summary:
    'O que coletamos, o que de propósito nunca guardamos, quem processa junto com a gente e como nos obrigar a apagar.',
  updated: '2026-11-03',
  sections: [
    {
      id: 'who-is-responsible',
      heading: 'Quem é o responsável',
      paragraphs: [
        'O controlador dos dados pessoais descritos aqui é Gabriel Barbosa, pessoa física, que também é o encarregado pelo tratamento de dados previsto na LGPD. Contato para qualquer pedido: contato@nekolog.io.',
        'Esta política vale para o serviço hospedado em nekolog.io. Uma instância que você mesmo sobe é controlada por quem a roda, e esta política não se aplica a ela.',
      ],
    },
    {
      id: 'two-kinds-of-data',
      heading: 'Dois tipos de dado, dois papéis diferentes',
      paragraphs: [
        'Os dados da sua conta — o que você nos dá para ter uma conta — são dados que nós controlamos. É deles que esta política trata.',
        'Os logs que a sua aplicação manda são outra coisa. Qualquer dado pessoal dentro deles é você que decide mandar; você é o controlador e nós somos operador, agindo conforme a sua instrução. Guardamos esses logs, mostramos para você e apagamos quando a retenção vence, e não fazemos mais nada com eles.',
      ],
    },
    {
      id: 'what-we-collect',
      heading: 'O que coletamos',
      paragraphs: ['Para operar o serviço hospedado, guardamos:'],
      items: [
        'conta: seu nome, e-mail, o hash da sua senha e as suas preferências de idioma, fuso horário e tema',
        'segurança: a hora de cada login, o país derivado do endereço IP e o user agent do navegador, para você poder revisar suas sessões e para detectarmos abuso',
        'uso: quantos eventos cada projeto e ambiente recebeu por minuto, que é como a cota é aplicada',
        'suporte: o que você nos escrever, pelo tempo necessário para resolver',
        'logs: o que a sua aplicação mandar, que é decisão sua',
      ],
    },
    {
      id: 'what-we-never-store',
      heading: 'O que de propósito nunca guardamos',
      paragraphs: ['Algumas coisas ficam de fora por decisão, não por esquecimento:'],
      items: [
        'o seu endereço IP — ele vira país e é descartado; o endereço em si nunca é escrito em lugar nenhum',
        'a sua senha — só um hash argon2id dela, que não dá para reverter',
        'as suas keys de API — só o hash SHA-256; a key aparece uma vez, na criação, e nunca mais',
        'qualquer coisa de rastreador de terceiro: não há nenhum neste site',
      ],
    },
    {
      id: 'why',
      heading: 'Com que base usamos',
      paragraphs: [
        'Dados de conta e de uso são tratados para executar o contrato entre nós — entregar o serviço que você pediu (LGPD, artigo 7º, V).',
        'Dados de segurança são tratados pelo legítimo interesse de manter a plataforma e quem a usa em segurança (artigo 7º, IX), limitados ao que essa finalidade exige.',
        'E-mail que não seja sobre o funcionamento da sua conta — um comunicado, por exemplo — só é enviado com o seu consentimento, que você pode retirar a qualquer momento sem perder acesso ao serviço.',
      ],
    },
    {
      id: 'retention',
      heading: 'Por quanto tempo guardamos',
      paragraphs: ['Cada tipo de dado tem o seu próprio relógio:'],
      items: [
        'logs: a retenção configurada no ambiente, 7 dias por padrão, depois dos quais o banco os apaga sozinho',
        'dados de conta: enquanto a conta existir e, depois, pelo prazo em que a lei brasileira exige guardar registro',
        'registros de segurança e de auditoria: 12 meses',
        'backups: 30 dias, depois dos quais a cópia é destruída — uma exclusão que você pede é aplicada na hora no banco em uso e alcança os backups conforme eles vencem',
      ],
    },
    {
      id: 'processors',
      heading: 'Quem trata dados junto com a gente',
      paragraphs: [
        'Usamos infraestrutura de terceiros, cada uma para uma finalidade só, e nenhuma delas recebe os seus dados para finalidade própria:',
      ],
      items: [
        'Cloudflare — recebe e roteia as requisições, guarda os hashes das keys e os arquivos de exportação',
        'Oracle Cloud — a máquina virtual onde roda o banco de logs',
        'Neon — o banco com contas, organizações, projetos e keys',
        'Upstash — o armazenamento temporário de sessões e códigos de login',
        'Vercel — serve este site e o dashboard',
        'Resend — entrega os nossos e-mails',
      ],
    },
    {
      id: 'international-transfer',
      heading: 'Dados fora do Brasil',
      paragraphs: [
        'Esses fornecedores operam servidores fora do Brasil, então rodar o serviço envolve transferência internacional de dados (LGPD, artigo 33). Escolhemos fornecedores que se comprometem contratualmente com proteção equivalente à que a LGPD exige, e mandamos para cada um só o que a finalidade dele precisa.',
      ],
    },
    {
      id: 'cookies',
      heading: 'Cookies',
      paragraphs: [
        'Usamos cookies só para o que não funcionaria sem eles: manter você logado, lembrar o seu idioma e lembrar o seu tema. Não há cookie de analytics, nem de publicidade, nem de terceiro.',
        'Como nenhum deles rastreia você, também não há aquela faixa pedindo que você os aceite.',
      ],
    },
    {
      id: 'your-rights',
      heading: 'Os seus direitos',
      paragraphs: [
        'A LGPD dá a você o direito de confirmar que tratamos os seus dados, de acessá-los, de corrigi-los, de pedir anonimização ou eliminação, de levá-los a outro lugar em formato portável, de saber com quem compartilhamos e de revogar um consentimento que você deu.',
        'Escreva para contato@nekolog.io e respondemos em até 15 dias. Podemos pedir que você confirme sua identidade antes, para que ninguém exerça os seus direitos no seu lugar.',
        'Se achar que não tratamos bem o seu pedido, você pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).',
      ],
    },
    {
      id: 'deletion',
      heading: 'Apagar a sua conta',
      paragraphs: [
        'Você mesmo pode apagar a sua conta, pelo dashboard, sem escrever para ninguém. A exclusão remove os dados da sua conta e os logs das organizações que só existem por causa de você.',
        'Uma organização com outros membros sobrevive à sua saída: os logs dela não são seus para apagar. Registros que a lei nos obriga a guardar — um evento de segurança, por exemplo — ficam pelo prazo exigido e nada além disso.',
      ],
    },
    {
      id: 'security',
      heading: 'Como protegemos',
      paragraphs: [
        'Tudo trafega por TLS. Senhas usam hash argon2id, keys de API usam SHA-256. Cada componente tem só as permissões de banco que o trabalho dele exige, segredos nunca moram no código-fonte, e este site é servido com uma política de segurança de conteúdo que bloqueia qualquer script que não tenhamos colocado ali.',
        'Nosso modelo de ameaças é público, no repositório, incluindo os riscos que aceitamos e por quê. Nenhum sistema é imune, e o nosso é mantido por uma pessoa só — preferimos que você saiba disso a que suponha o contrário.',
      ],
    },
    {
      id: 'incidents',
      heading: 'Se algo der errado',
      paragraphs: [
        'Se um incidente de segurança colocar os seus dados em risco relevante, comunicaremos a ANPD e você, dizendo o que aconteceu, quais dados foram envolvidos e o que estamos fazendo a respeito, como exige o artigo 48 da LGPD.',
      ],
    },
    {
      id: 'children',
      heading: 'Crianças e adolescentes',
      paragraphs: [
        'O serviço não é dirigido a menores de 18 anos e não coletamos dados deles conscientemente. Se você acha que um menor tem conta aqui, escreva para contato@nekolog.io e nós a apagamos.',
      ],
    },
    {
      id: 'changes',
      heading: 'Mudanças nesta política',
      paragraphs: [
        'A data no topo mostra a última mudança. Mudanças relevantes são avisadas por e-mail a quem tem conta com pelo menos 15 dias de antecedência, para você poder discordar antes que elas valham para você.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contato',
      paragraphs: [
        'Qualquer dúvida ou pedido sobre os seus dados: contato@nekolog.io. O mesmo endereço chega ao encarregado.',
      ],
    },
  ],
}
