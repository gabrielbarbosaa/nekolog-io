import { redirect } from 'next/navigation'
import { signedIn } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const signed = await signedIn()
  const first = signed.organizations[0]

  redirect(first === undefined ? '/start' : `/${first.id}/projects`)
}
