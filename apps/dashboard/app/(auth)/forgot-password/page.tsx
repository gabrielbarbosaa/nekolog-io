import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthFrame } from '@/components/auth-frame'
import { Recover } from './recover'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const t = await getTranslations('Auth')

  return (
    <AuthFrame
      title={t('forgotTitle')}
      body={t('forgotBody')}
      under={
        <Link href="/login" className="text-muted-foreground underline-offset-4 hover:underline">
          {t('signInTitle')}
        </Link>
      }
    >
      <Recover />
    </AuthFrame>
  )
}
