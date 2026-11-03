import type { LegalDocument } from '../document'

export const terms: LegalDocument = {
  id: 'terms',
  title: 'Termos de uso',
  summary:
    'O que o NekoLog oferece, o que você assume ao usá-lo e o que nenhum dos dois lados pode prometer ao outro.',
  updated: '2026-11-03',
  sections: [
    {
      id: 'who-we-are',
      heading: 'Quem mantém o NekoLog',
      paragraphs: [
        'O NekoLog é mantido por Gabriel Barbosa, pessoa física, no contato@nekolog.io. Não é uma empresa, e o serviço hospedado é oferecido gratuitamente.',
        'Estes termos valem para o serviço hospedado em nekolog.io. Se você mesmo roda o NekoLog a partir do repositório aberto, eles não se aplicam a você: a sua instância é sua.',
      ],
    },
    {
      id: 'what-the-service-is',
      heading: 'O que é o serviço',
      paragraphs: [
        'O NekoLog recebe os logs que a sua aplicação manda pelos nossos SDKs, guarda por um período limitado e mostra para você num dashboard com busca, gráficos e alertas.',
        'Os SDKs, a API de ingestão, os jobs e este site são abertos, sob licença MIT. O dashboard é fechado e roda só na instância hospedada.',
      ],
    },
    {
      id: 'accounts',
      heading: 'Contas',
      paragraphs: [
        'Na instância hospedada, conta só nasce de convite — nosso ou de alguém da organização em que você está entrando.',
        'Você responde por tudo que for feito com as suas credenciais. Avise no contato@nekolog.io assim que desconfiar que mais alguém as tem.',
        'É preciso ter 18 anos ou mais para ter conta.',
      ],
    },
    {
      id: 'your-logs',
      heading: 'Os logs que você manda são seus, e são responsabilidade sua',
      paragraphs: [
        'Quem decide o que a aplicação manda é você. Nós guardamos e mostramos de volta; não lemos, não vendemos e não usamos para treinar nada.',
        'Pela LGPD, você é o controlador de qualquer dado pessoal dentro desses logs, e nós somos operador. Mande só o que precisa. Nossos SDKs removem segredos comuns antes de qualquer coisa sair do seu processo, mas isso é uma rede de proteção, não uma garantia — a obrigação de não mandar o que não devia continua sendo sua.',
      ],
    },
    {
      id: 'acceptable-use',
      heading: 'O que você não pode fazer',
      paragraphs: ['Ao usar o serviço hospedado, você se compromete a não:'],
      items: [
        'mandar conteúdo ilícito, ou que você não tenha o direito de mandar',
        'tentar ler, escrever ou deduzir qualquer coisa de outra organização',
        'contornar cotas, limites de taxa ou a exigência de convite',
        'atacar a plataforma ou usá-la para atacar alguém, incluindo testá-la sem autorização por escrito',
        'revender o serviço hospedado ou apresentá-lo como seu',
      ],
    },
    {
      id: 'quotas-and-retention',
      heading: 'Cotas e retenção',
      paragraphs: [
        'A instância hospedada aceita até 10 mil eventos por dia por organização e os guarda por 7 dias, por padrão. Os dois valores podem ser ajustados por organização, e o que vale no momento aparece sempre no dashboard.',
        'Os logs são apagados automaticamente quando a retenção vence. Apagar é definitivo: não existe arquivo de onde restaurá-los. Se você precisa deles por mais tempo, exporte antes do vencimento.',
      ],
    },
    {
      id: 'availability',
      heading: 'Sem nível de serviço e sem garantia',
      paragraphs: [
        'O serviço é fornecido como está. Ele roda nas cotas gratuitas de terceiros e é mantido por uma pessoa só, no tempo livre. Pode ficar lento, pode parar, pode mudar, e eventos podem se perder.',
        'Não faça do NekoLog o único registro de algo que você não pode perder — trilha de auditoria, obrigação legal, base de cobrança. Guarde a sua própria cópia do que importa tanto assim.',
        'Nos limites da lei, não respondemos por dano indireto, lucro cessante ou perda de dados decorrentes do uso do serviço hospedado.',
      ],
    },
    {
      id: 'suspension',
      heading: 'Suspensão e fim do serviço',
      paragraphs: [
        'Podemos suspender conta ou organização que descumpra estes termos, ou cujo uso coloque a plataforma e outras pessoas em risco. Quando for razoável avisar antes, avisamos.',
        'Você pode parar de usar quando quiser e pedir a exclusão da sua conta. Nós também podemos encerrar a instância hospedada; se isso acontecer, avisamos por e-mail com pelo menos 30 dias de antecedência para você exportar seus dados.',
      ],
    },
    {
      id: 'intellectual-property',
      heading: 'Propriedade intelectual',
      paragraphs: [
        'O repositório público é licenciado sob MIT, e é essa licença que diz o que você pode fazer com aquele código. O dashboard não está coberto por ela e não é licenciado para redistribuição.',
        'O nome NekoLog e as marcas do projeto não estão cobertos pela licença MIT. Você pode dizer que o seu produto funciona com o NekoLog; não pode apresentar um fork como sendo o NekoLog.',
      ],
    },
    {
      id: 'changes',
      heading: 'Mudanças nestes termos',
      paragraphs: [
        'Podemos mudar estes termos. A data no topo mostra sempre a última mudança, e mudanças relevantes são avisadas por e-mail a quem tem conta com pelo menos 15 dias de antecedência.',
        'Continuar usando o serviço depois dessa data significa aceitar a nova versão. Se você não aceita, pare de usar e peça a exclusão da conta.',
      ],
    },
    {
      id: 'law',
      heading: 'Lei aplicável',
      paragraphs: [
        'Estes termos são regidos pela lei brasileira. Em relação de consumo, o foro competente é o do domicílio do consumidor, como prevê o Código de Defesa do Consumidor.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contato',
      paragraphs: ['Dúvidas sobre estes termos: contato@nekolog.io.'],
    },
  ],
}
