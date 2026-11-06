export type LicensedPackage = {
  name: string
  versions: string[]
}

export type Listing = Record<string, LicensedPackage[]>

export type Refusal = {
  licence: string
  name: string
  versions: string[]
}

export const MINIMUM_PACKAGES: number = 300

const DENIED_IDENTIFIER = /^a?gpl(-|\+|$)/i
const GENERAL_PUBLIC_LICENSE = /GENERAL PUBLIC LICENSE/
const LESSER = /LESSER/

export function isDenied(term: string): boolean {
  const normalised = term
    .trim()
    .toUpperCase()
    .replace(/\s+WITH\s+.*$/, '')

  if (DENIED_IDENTIFIER.test(normalised)) {
    return true
  }

  return GENERAL_PUBLIC_LICENSE.test(normalised) && !LESSER.test(normalised)
}

export function termsOf(expression: string): string[][] {
  return expression
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+/i)
    .map((alternative) => alternative.split(/\s+AND\s+/i).map((term) => term.trim()))
    .filter((alternative) => alternative.length > 0)
}

export function refuses(expression: string): boolean {
  const alternatives = termsOf(expression)

  if (alternatives.length === 0) {
    return false
  }

  return alternatives.every((alternative) => alternative.some(isDenied))
}

export function refusalsIn(listing: Listing): Refusal[] {
  const refusals: Refusal[] = []

  for (const [licence, packages] of Object.entries(listing)) {
    if (!refuses(licence)) {
      continue
    }

    for (const found of packages) {
      refusals.push({ licence, name: found.name, versions: found.versions })
    }
  }

  return refusals.sort((one, other) => one.name.localeCompare(other.name))
}

export function countOf(listing: Listing): number {
  return Object.values(listing).reduce((total, packages) => total + packages.length, 0)
}

export function parseListing(text: string): Listing {
  const withoutMark = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const parsed: unknown = JSON.parse(withoutMark)

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('the licence listing is not an object keyed by licence')
  }

  const listing = parsed as Record<string, unknown>

  for (const [licence, packages] of Object.entries(listing)) {
    if (!Array.isArray(packages)) {
      throw new Error(`the licence listing holds no array under ${JSON.stringify(licence)}`)
    }

    for (const found of packages) {
      if (
        found === null ||
        typeof found !== 'object' ||
        typeof (found as LicensedPackage).name !== 'string'
      ) {
        throw new Error(`the licence listing holds a nameless package under ${licence}`)
      }
    }
  }

  const counted = countOf(listing as Listing)

  if (counted < MINIMUM_PACKAGES) {
    throw new Error(
      `${counted} packages is not the whole workspace: run pnpm with -r, and check nothing failed before the pipe`,
    )
  }

  return listing as Listing
}
