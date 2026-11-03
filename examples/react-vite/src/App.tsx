import { addBreadcrumb, ErrorBoundary, setUser, useLogger } from '@nekolog-io/react'
import { type ReactElement, useState } from 'react'

export const CUSTOMER_ID = 'cus_7f3a91'

export function Checkout(): ReactElement {
  const log = useLogger()
  const [broken, setBroken] = useState(false)

  if (broken) {
    throw new Error('the payment component gave up')
  }

  return (
    <section>
      <h1>Checkout</h1>
      <button
        type="button"
        data-testid="sign-in"
        onClick={() => {
          setUser(CUSTOMER_ID)
          log.info('Signed in')
        }}
      >
        Entrar
      </button>
      <button
        type="button"
        data-testid="apply-coupon"
        onClick={() => {
          addBreadcrumb('coupon applied', { code: 'WELCOME' })
          log.info('Coupon applied', { 'coupon.code': 'WELCOME' })
        }}
      >
        Aplicar cupom
      </button>
      <button type="button" data-testid="break" onClick={() => setBroken(true)}>
        Quebrar de propósito
      </button>
    </section>
  )
}

export function App(): ReactElement {
  return (
    <ErrorBoundary name="checkout" fallback={<p data-testid="fallback">Algo deu errado.</p>}>
      <Checkout />
    </ErrorBoundary>
  )
}
