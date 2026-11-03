export interface EmailMessage {
  to: string
  subject: string
  html: string
  text?: string
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>
}
