import { MAILPIT_URL } from '../../playwright.config'

type Summary = { ID: string; Subject: string; Created: string }

export const CODE = /\b([A-Z0-9]{3}-[A-Z0-9]{3})\b/

async function search(address: string): Promise<Summary[]> {
  const response = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  )
  const body = (await response.json()) as { messages?: Summary[] }
  return body.messages ?? []
}

export async function clearMail(address: string): Promise<void> {
  const ids = (await search(address)).map((message) => message.ID)
  if (ids.length === 0) {
    return
  }
  await fetch(`${MAILPIT_URL}/api/v1/messages`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ IDs: ids }),
  })
}

export async function waitForMail(
  address: string,
  subject: string,
): Promise<{ subject: string; text: string }> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const found = (await search(address))
      .filter((message) => message.Subject.includes(subject))
      .sort((one, other) => Date.parse(other.Created) - Date.parse(one.Created))

    const newest = found[0]
    if (newest !== undefined) {
      const full = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${newest.ID}`)).json()) as {
        Text: string
      }
      return { subject: newest.Subject, text: full.Text }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`no message to ${address} with a subject holding "${subject}"`)
}

export async function codeFromMail(address: string, subject: string): Promise<string> {
  const message = await waitForMail(address, subject)
  const found = CODE.exec(message.text)
  if (found === null) {
    throw new Error(`the message to ${address} carries no code: ${message.text.slice(0, 200)}`)
  }
  return found[1] as string
}
