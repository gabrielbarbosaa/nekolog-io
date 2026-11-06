import { MIN_PASSWORD_LENGTH } from '@internal/auth'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthFrame } from '@/components/auth-frame'
import { Reset } from './reset'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const t = await getTranslations('Auth')

  return (
    <AuthFrame
      title={t('resetTitle')}
      body={t('resetBody')}
      under={
        <Link href="/login" className="text-muted-foreground underline-offset-4 hover:underline">
          {t('signInTitle')}
        </Link>
      }
    >
      <Reset minPassword={MIN_PASSWORD_LENGTH} />
    </AuthFrame>
  )
}
