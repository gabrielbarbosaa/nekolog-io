import type { EnvironmentColor } from '@internal/auth'
import { cn } from '@/lib/utils'

const DOT: Readonly<Record<EnvironmentColor, string>> = {
  'chart-1': 'bg-chart-1',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
  'chart-6': 'bg-chart-6',
  'chart-7': 'bg-chart-7',
  'chart-8': 'bg-chart-8',
}

export const COLOURS: ReadonlyArray<EnvironmentColor> = Object.keys(DOT) as EnvironmentColor[]

export const COLOUR_NAMES: Readonly<Record<EnvironmentColor, string>> = {
  'chart-1': 'blue',
  'chart-2': 'orange',
  'chart-3': 'teal',
  'chart-4': 'amber',
  'chart-5': 'pink',
  'chart-6': 'green',
  'chart-7': 'violet',
  'chart-8': 'red',
}

export function EnvDot({ colour, className }: { colour?: string; className?: string }) {
  const known = (DOT as Record<string, string | undefined>)[colour ?? ''] ?? 'bg-muted-foreground'

  return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', known, className)} />
}
