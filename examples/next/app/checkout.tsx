'use client'

import { setUser, useLogger } from '@nekolog-io/next/client'
import type { ReactElement } from 'react'

export const CUSTOMER_ID = 'cus_7f3a91'

export function Checkout(): ReactElement {
  const log = useLogger()

  return (
    <button
      type="button"
      onClick={() => {
        setUser(CUSTOMER_ID)
        log.info('Checkout opened', { step: 'payment' })
      }}
    >
      Pagar
    </button>
  )
}
