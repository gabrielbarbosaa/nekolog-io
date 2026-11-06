import {
  describeCountry,
  describeDevice,
  type EmailLocale,
  escapeHtml,
  localeFor,
} from './code-email.ts'

export type NoticeFor = 'password-changed' | 'email-changed' | 'token-reused'

export const NOTICES: readonly NoticeFor[] = ['password-changed', 'email-changed', 'token-reused']

type Copy = {
  subject: Readonly<Record<NoticeFor, string>>
  heading: Readonly<Record<NoticeFor, string>>
  body: Readonly<Record<NoticeFor, string>>
  device: string
  country: string
  when: string
  noLink: string
}

const COPY: Readonly<Record<EmailLocale, Copy>> = {
  en: {
    subject: {
      'password-changed': 'Your password was changed',
      'email-changed': 'Your e-mail address was changed',
      'token-reused': 'We signed one of your devices out',
    },
    heading: {
      'password-changed': 'Your password was changed',
      'email-changed': 'Your e-mail address was changed',
      'token-reused': 'We signed one of your devices out',
    },
    body: {
      'password-changed':
        'Every device was signed out. If this was not you, ask for a new password now and tell us.',
      'email-changed':
        'From now on you sign in with the new address. If this was not you, tell us now.',
      'token-reused':
        'A session token was used twice, which happens when one is copied. We ended that session. ' +
        'If you did not just sign in somewhere new, change your password now.',
    },
    device: 'Browser',
    country: 'Country',
    when: 'Happened at',
    noLink: 'This message has no link that signs you in. We will never send one.',
  },
  'pt-BR': {
    subject: {
      'password-changed': 'Sua senha foi trocada',
      'email-changed': 'Seu endereço de e-mail foi trocado',
      'token-reused': 'Desconectamos um dos seus aparelhos',
    },
    heading: {
      'password-changed': 'Sua senha foi trocada',
      'email-changed': 'Seu endereço de e-mail foi trocado',
      'token-reused': 'Desconectamos um dos seus aparelhos',
    },
    body: {
      'password-changed':
        'Todos os aparelhos foram desconectados. Se não foi você, peça uma senha nova agora e nos avise.',
      'email-changed':
        'De agora em diante você entra com o endereço novo. Se não foi você, nos avise agora.',
      'token-reused':
        'Um token de sessão foi usado duas vezes, o que acontece quando alguém o copia. ' +
        'Encerramos aquela sessão. Se você não acabou de entrar em algum lugar novo, troque sua senha agora.',
    },
    device: 'Navegador',
    country: 'País',
    when: 'Aconteceu em',
    noLink: 'Esta mensagem não tem link que faz login. Nunca vamos mandar um.',
  },
  es: {
    subject: {
      'password-changed': 'Tu contraseña fue cambiada',
      'email-changed': 'Tu dirección de correo fue cambiada',
      'token-reused': 'Cerramos la sesión de uno de tus dispositivos',
    },
    heading: {
      'password-changed': 'Tu contraseña fue cambiada',
      'email-changed': 'Tu dirección de correo fue cambiada',
      'token-reused': 'Cerramos la sesión de uno de tus dispositivos',
    },
    body: {
      'password-changed':
        'Todos los dispositivos fueron desconectados. Si no fuiste tú, pide una contraseña nueva ahora y avísanos.',
      'email-changed':
        'A partir de ahora entras con la dirección nueva. Si no fuiste tú, avísanos ahora.',
      'token-reused':
        'Un token de sesión se usó dos veces, lo que pasa cuando alguien lo copia. ' +
        'Terminamos esa sesión. Si no acabas de entrar en un lugar nuevo, cambia tu contraseña ahora.',
    },
    device: 'Navegador',
    country: 'País',
    when: 'Ocurrió el',
    noLink: 'Este mensaje no tiene ningún enlace que inicie sesión. Nunca enviaremos uno.',
  },
}

export type SecurityNotice = {
  purpose: NoticeFor
  locale: string | undefined
  device: string
  country: string
  at: number
}

export type NoticeEmail = { subject: string; html: string; text: string }

export function noticeEmail(notice: SecurityNotice): NoticeEmail {
  const copy = COPY[localeFor(notice.locale)]
  const subject = copy.subject[notice.purpose]
  const facts: Array<[string, string]> = [
    [copy.device, describeDevice(notice.device)],
    [copy.country, describeCountry(notice.country)],
    [copy.when, new Date(notice.at).toISOString().replace('T', ' ').slice(0, 16)],
  ]

  const rows = facts
    .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join('')

  const html = [
    `<h1>${escapeHtml(copy.heading[notice.purpose])}</h1>`,
    `<p>${escapeHtml(copy.body[notice.purpose])}</p>`,
    `<table>${rows}</table>`,
    `<p>${escapeHtml(copy.noLink)}</p>`,
  ].join('')

  const text = [
    copy.heading[notice.purpose],
    '',
    copy.body[notice.purpose],
    '',
    ...facts.map(([label, value]) => `${label}: ${value}`),
    '',
    copy.noLink,
  ].join('\n')

  return { subject, html, text }
}
