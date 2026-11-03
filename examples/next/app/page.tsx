import type { ReactElement } from 'react'
import { Checkout } from './checkout'

export default function Home(): ReactElement {
  return (
    <main>
      <h1>Checkout</h1>
      <Checkout />
    </main>
  )
}
