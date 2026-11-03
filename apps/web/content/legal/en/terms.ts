import type { LegalDocument } from '../document'

export const terms: LegalDocument = {
  id: 'terms',
  title: 'Terms of Use',
  summary:
    'What NekoLog offers, what you take on by using it, and what neither of us can promise the other.',
  updated: '2026-11-03',
  sections: [
    {
      id: 'who-we-are',
      heading: 'Who runs NekoLog',
      paragraphs: [
        'NekoLog is run by Gabriel Barbosa, an individual, reachable at contato@nekolog.io. It is not a company, and the hosted service is offered free of charge.',
        'These terms govern the hosted service at nekolog.io. If you run NekoLog yourself from the open source repository, they do not apply to you: your instance is yours.',
      ],
    },
    {
      id: 'what-the-service-is',
      heading: 'What the service is',
      paragraphs: [
        'NekoLog receives logs your application sends through our SDKs, stores them for a limited period, and shows them to you in a dashboard with search, charts and alerts.',
        'The SDKs, the ingestion API, the background jobs and this site are open source under the MIT licence. The dashboard is closed source and runs only on the hosted instance.',
      ],
    },
    {
      id: 'accounts',
      heading: 'Accounts',
      paragraphs: [
        'Accounts on the hosted instance exist by invitation only — either from us or from a member of an organization you are joining.',
        'You are responsible for everything done with your credentials. Tell us at contato@nekolog.io as soon as you suspect someone else has them.',
        'You must be 18 or older to hold an account.',
      ],
    },
    {
      id: 'your-logs',
      heading: 'The logs you send are yours, and your responsibility',
      paragraphs: [
        'You decide what your application sends. We store it and show it back to you; we do not read it, sell it, or use it to train anything.',
        'Under Brazilian data protection law you are the controller of any personal data inside those logs, and we act as your processor. Send only what you need. Our SDKs strip common secrets before anything leaves your process, but that is a safety net, not a guarantee — the obligation to not send what should not be sent stays with you.',
      ],
    },
    {
      id: 'acceptable-use',
      heading: 'What you may not do',
      paragraphs: ['Using the hosted service, you agree not to:'],
      items: [
        'send content that is unlawful, or that you have no right to send',
        'try to read, write or infer anything belonging to another organization',
        'work around quotas, rate limits or the invitation requirement',
        'attack the platform or use it to attack someone else, including probing it without written permission',
        'resell the hosted service or present it as your own',
      ],
    },
    {
      id: 'quotas-and-retention',
      heading: 'Quotas and retention',
      paragraphs: [
        'The hosted instance accepts up to 10,000 events per day per organization and keeps them for 7 days by default. Both can be adjusted for an organization, and the current values always appear in the dashboard.',
        'Logs are deleted automatically when their retention expires. Deletion is final: there is no archive to restore them from. If you need them for longer, export them before they expire.',
      ],
    },
    {
      id: 'availability',
      heading: 'No service level, and no warranty',
      paragraphs: [
        'The service is provided as is. It runs on free tiers of third-party providers and is maintained by one person in their spare time. It may be slow, interrupted, or changed, and events may be lost.',
        'Do not make NekoLog the only record of something you cannot afford to lose — an audit trail, a legal obligation, a billing source. Keep your own copy of anything that matters that much.',
        'To the extent the law allows, we are not liable for indirect damage, lost profit, or loss of data arising from use of the hosted service.',
      ],
    },
    {
      id: 'suspension',
      heading: 'Suspension and ending the service',
      paragraphs: [
        'We may suspend an account or an organization that breaks these terms, or whose use puts the platform or other users at risk. Where it is reasonable to warn first, we will.',
        'You may stop using the service at any time and ask us to delete your account. We may also discontinue the hosted instance; if we do, we will give at least 30 days notice by e-mail so you can export your data.',
      ],
    },
    {
      id: 'intellectual-property',
      heading: 'Intellectual property',
      paragraphs: [
        'The public repository is licensed under MIT, and that licence governs what you may do with that code. The dashboard is not covered by it and is not licensed for redistribution.',
        'The name NekoLog and the project marks are not covered by the MIT licence. You may say your product works with NekoLog; you may not present a fork as NekoLog.',
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to these terms',
      paragraphs: [
        'We may change these terms. The date at the top always shows the last change, and material changes are announced by e-mail to account holders at least 15 days before they take effect.',
        'Continuing to use the service after that date means you accept the new version. If you do not, stop using it and ask us to delete your account.',
      ],
    },
    {
      id: 'law',
      heading: 'Governing law',
      paragraphs: [
        'These terms are governed by the laws of Brazil. For a consumer relationship, the competent court is the one of the consumer’s domicile, as the Consumer Protection Code provides.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      paragraphs: ['Questions about these terms: contato@nekolog.io.'],
    },
  ],
}
