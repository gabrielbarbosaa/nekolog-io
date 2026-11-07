import { cn } from '@/lib/utils'

export const LOGO_WIDTH = 256
export const LOGO_HEIGHT = 281

export function Logo({ size = 26, className }: { size?: number; className?: string }) {
  const height = Math.round((size * LOGO_HEIGHT) / LOGO_WIDTH)

  return (
    <span className={cn('inline-flex shrink-0', className)}>
      <img src="/logo-dark.png" alt="" width={size} height={height} className="block dark:hidden" />
      <img
        src="/logo-light.png"
        alt=""
        width={size}
        height={height}
        className="hidden dark:block"
      />
    </span>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Logo />
      <span className="font-semibold text-section tracking-tight">NekoLog</span>
    </span>
  )
}
