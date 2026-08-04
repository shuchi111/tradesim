import type { Metadata } from 'next'
import './globals.css'
import { CurrencyProvider } from '@/lib/currency'

export const metadata: Metadata = {
  title: 'TradeSim — Paper Trading Platform',
  description: 'Practice trading with real market data and virtual money',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <CurrencyProvider>{children}</CurrencyProvider>
      </body>
    </html>
  )
}
