import { defaultLocale, type Locale } from '../../i18n/locales'
import type { LegalDocument, LegalDocumentId } from './document'
import { privacy as privacyEn } from './en/privacy'
import { terms as termsEn } from './en/terms'
import { privacy as privacyEs } from './es/privacy'
import { terms as termsEs } from './es/terms'
import { privacy as privacyPtBr } from './pt-BR/privacy'
import { terms as termsPtBr } from './pt-BR/terms'

export const legalDocuments: Record<Locale, Record<LegalDocumentId, LegalDocument>> = {
  en: { terms: termsEn, privacy: privacyEn },
  'pt-BR': { terms: termsPtBr, privacy: privacyPtBr },
  es: { terms: termsEs, privacy: privacyEs },
}

export function legalDocument(id: LegalDocumentId, locale: Locale): LegalDocument {
  return (legalDocuments[locale] ?? legalDocuments[defaultLocale])[id]
}
