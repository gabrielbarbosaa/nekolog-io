'use client'

import type { ComponentProps, ReactNode } from 'react'
import { useId } from 'react'
import { cn } from '@/lib/utils'

export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block font-medium text-aside">
      {children}
    </label>
  )
}

export const inputStyle =
  'block w-full rounded-md border border-border bg-background px-2.5 py-1.5 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50'

export type FieldProps = Omit<ComponentProps<'input'>, 'id'> & {
  label: string
  hint?: string
  mono?: boolean
}

export function Field({ label, hint, mono, className, ...props }: FieldProps) {
  const id = useId()

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <input id={id} className={cn(inputStyle, mono && 'font-mono', className)} {...props} />
      {hint === undefined ? null : <p className="text-aside text-muted-foreground">{hint}</p>}
    </div>
  )
}

export type SelectProps = Omit<ComponentProps<'select'>, 'id'> & {
  label: string
  hint?: string
}

export function Select({ label, hint, className, children, ...props }: SelectProps) {
  const id = useId()

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={cn(inputStyle, 'pr-8', className)} {...props}>
        {children}
      </select>
      {hint === undefined ? null : <p className="text-aside text-muted-foreground">{hint}</p>}
    </div>
  )
}

export type AreaProps = Omit<ComponentProps<'textarea'>, 'id'> & {
  label: string
  hint?: string
}

export function Area({ label, hint, className, ...props }: AreaProps) {
  const id = useId()

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <textarea id={id} className={cn(inputStyle, 'font-mono', className)} {...props} />
      {hint === undefined ? null : <p className="text-aside text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function Notice({ kind, children }: { kind: 'bad' | 'good'; children: ReactNode }) {
  return (
    <p
      role={kind === 'bad' ? 'alert' : 'status'}
      className={cn('text-aside', kind === 'bad' ? 'text-destructive' : 'text-muted-foreground')}
    >
      {children}
    </p>
  )
}
