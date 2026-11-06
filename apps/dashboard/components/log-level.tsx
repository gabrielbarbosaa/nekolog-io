import type { Level } from '@/lib/explorer'
import { cn } from '@/lib/utils'

export const LEVEL_TEXT: Readonly<Record<Level, string>> = {
  trace: 'text-level-trace',
  debug: 'text-level-debug',
  info: 'text-level-info',
  warn: 'text-level-warn',
  error: 'text-level-error',
  fatal: 'text-level-fatal',
}

export function LevelTag({ level, className }: { level: Level; className?: string }) {
  return <span className={cn('font-medium', LEVEL_TEXT[level], className)}>{level}</span>
}
