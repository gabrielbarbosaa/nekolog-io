export const legalDocumentIds = ['terms', 'privacy'] as const

export type LegalDocumentId = (typeof legalDocumentIds)[number]

export type LegalSection = {
  id: string
  heading: string
  paragraphs: string[]
  items?: string[]
}

export type LegalDocument = {
  id: LegalDocumentId
  title: string
  summary: string
  updated: string
  sections: LegalSection[]
}

export function isLegalDocumentId(value: string): value is LegalDocumentId {
  return (legalDocumentIds as readonly string[]).includes(value)
}
