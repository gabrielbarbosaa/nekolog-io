import { globalDocument } from './globals.ts'

let hiding = false

export function markHiding(): void {
  hiding = true
}

export function markVisible(): void {
  hiding = false
}

export function pageIsHiding(): boolean {
  return hiding || globalDocument()?.visibilityState === 'hidden'
}
