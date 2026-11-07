'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { call } from '@/lib/client'

export function SignOut() {
  const t = useTranslations('Sidebar')
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      disabled={busy}
      className="block w-full rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
      onClick={async () => {
        setBusy(true)
        await call('/api/auth/logout', {})
        router.replace('/login')
        router.refresh()
      }}
    >
      {t('signOut')}
    </button>
  )
}
