import type { LegalDocument } from '../document'

export const privacy: LegalDocument = {
  id: 'privacy',
  title: 'Privacy Policy',
  summary:
    'What we collect, what we deliberately never store, who processes it with us, and how to make us delete it.',
  updated: '2026-11-03',
  sections: [
    {
      id: 'who-is-responsible',
      heading: 'Who is responsible',
      paragraphs: [
        'The controller of the personal data described here is Gabriel Barbosa, an individual, who also acts as the data protection officer under Brazil’s LGPD. Contact for any request: contato@nekolog.io.',
        'This policy covers the hosted service at nekolog.io. A self-hosted instance is controlled by whoever runs it, and this policy does not apply to it.',
      ],
    },
    {
      id: 'two-kinds-of-data',
      heading: 'Two kinds of data, two different roles',
      paragraphs: [
        'Your account data — the data you give us to have an account — is data we control. This policy explains what we do with it.',
        'The logs your application sends are different. Whatever personal data is inside them, you decide to send; you are its controller and we are your processor, acting on your instructions. We store those logs, show them to you and delete them when their retention expires, and we do nothing else with them.',
      ],
    },
    {
      id: 'what-we-collect',
      heading: 'What we collect',
      paragraphs: ['To run the hosted service we store:'],
      items: [
        'account: your name, e-mail address, a hash of your password, and your language, time zone and theme preferences',
        'security: the time of each sign-in, the country derived from the IP address, and the browser’s user agent, so you can review your sessions and so we can detect abuse',
        'usage: how many events each project and environment received per minute, which is how quotas are applied',
        'support: anything you write to us, for as long as it takes to resolve it',
        'logs: whatever your application sends, which is up to you',
      ],
    },
    {
      id: 'what-we-never-store',
      heading: 'What we deliberately never store',
      paragraphs: ['Some things are left out by design, not by omission:'],
      items: [
        'your IP address — it is turned into a country and discarded; the address itself is never written down',
        'your password — only an argon2id hash of it, which cannot be reversed',
        'your API keys — only a SHA-256 hash; a key is shown once, at creation, and never again',
        'anything from third-party trackers: there are none on this site',
      ],
    },
    {
      id: 'why',
      heading: 'Why we may use it',
      paragraphs: [
        'Account and usage data is processed to perform the contract between us — to give you the service you asked for (LGPD, article 7, V).',
        'Security data is processed under our legitimate interest in keeping the platform and its users safe (article 7, IX), limited to what that purpose needs.',
        'Any e-mail that is not about running your account — an announcement, say — is sent only with your consent, which you can withdraw at any time without losing access to the service.',
      ],
    },
    {
      id: 'retention',
      heading: 'How long we keep it',
      paragraphs: ['Each kind of data has its own clock:'],
      items: [
        'logs: the retention configured for the environment, 7 days by default, after which the database deletes them automatically',
        'account data: while the account exists, and then for the period Brazilian law requires us to keep records',
        'security and audit records: 12 months',
        'backups: 30 days, after which the copy is destroyed — a deletion you request is applied to the live database immediately and reaches the backups as they expire',
      ],
    },
    {
      id: 'processors',
      heading: 'Who processes data with us',
      paragraphs: [
        'We use third-party infrastructure, each for a single purpose, and none of them receives your data for purposes of their own:',
      ],
      items: [
        'Cloudflare — receives and routes the requests, stores API key hashes and export files',
        'Oracle Cloud — the virtual machine where the log database runs',
        'Neon — the database holding accounts, organizations, projects and keys',
        'Upstash — the short-lived session and login-code store',
        'Vercel — serves this site and the dashboard',
        'Resend — delivers our e-mail',
      ],
    },
    {
      id: 'international-transfer',
      heading: 'Data outside Brazil',
      paragraphs: [
        'Those providers operate servers outside Brazil, so running the service involves an international transfer of data (LGPD, article 33). We choose providers that commit contractually to protection equivalent to what the LGPD requires, and we send each of them only what its single purpose needs.',
      ],
    },
    {
      id: 'cookies',
      heading: 'Cookies',
      paragraphs: [
        'We use cookies only for things that would not work without them: keeping you signed in, remembering your language and remembering your theme. There is no analytics cookie, no advertising cookie and no third-party cookie.',
        'Because none of them tracks you, there is no banner asking you to accept them.',
      ],
    },
    {
      id: 'your-rights',
      heading: 'Your rights',
      paragraphs: [
        'The LGPD gives you the right to confirm that we process your data, to access it, to correct it, to ask for it to be anonymised or deleted, to take it elsewhere in a portable format, to know who we share it with, and to withdraw a consent you gave.',
        'Write to contato@nekolog.io and we will answer within 15 days. We may ask you to confirm your identity first, so that nobody else can exercise your rights for you.',
        'If you believe we have not handled your request properly, you may complain to Brazil’s National Data Protection Authority (ANPD).',
      ],
    },
    {
      id: 'deletion',
      heading: 'Deleting your account',
      paragraphs: [
        'You can delete your account yourself, from the dashboard, without writing to anyone. Deletion removes your account data and the logs of organizations that exist only because of you.',
        'An organization with other members survives you leaving it: their logs are not yours to delete. Records we must keep by law — a security event, for instance — are kept for the required period and nothing more.',
      ],
    },
    {
      id: 'security',
      heading: 'How we protect it',
      paragraphs: [
        'Everything travels over TLS. Passwords are hashed with argon2id, API keys with SHA-256. Each component holds only the database permissions its job needs, secrets never live in the source code, and this site is served with a content security policy that blocks any script we did not put there ourselves.',
        'Our threat model is public, in the repository, including the risks we have accepted and why. No system is immune, and ours is maintained by one person — we would rather you knew that than assumed otherwise.',
      ],
    },
    {
      id: 'incidents',
      heading: 'If something goes wrong',
      paragraphs: [
        'If a security incident puts your data at relevant risk, we will notify the ANPD and you, describing what happened, what data was involved and what we are doing about it, as article 48 of the LGPD requires.',
      ],
    },
    {
      id: 'children',
      heading: 'Children',
      paragraphs: [
        'The service is not directed at anyone under 18 and we do not knowingly collect their data. If you believe a minor has an account, write to contato@nekolog.io and we will delete it.',
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      paragraphs: [
        'The date at the top shows the last change. Material changes are announced by e-mail to account holders at least 15 days before they take effect, so that you can disagree before they apply to you.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      paragraphs: [
        'Any question or request about your data: contato@nekolog.io. The same address reaches the data protection officer.',
      ],
    },
  ],
}
