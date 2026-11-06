import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

export const FONT_SIZES = ['data', 'aside', 'section', 'screen'] as const

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs))
}
