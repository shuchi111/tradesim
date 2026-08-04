import { getYahooSymbol } from '@/types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'

/**
 * Fetch OHLCV candlestick data from Yahoo Finance.
 */
export async function getKlines(
  symbol: string,
  interval: string,
  range: string = '1mo'
): Promise<
  { time: number; open: number; high: number; low: number; close: number; volume: number }[]
> {
  const yahooSymbol = getYahooSymbol(symbol)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${interval}&range=${range}`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Yahoo Finance request failed: ${res.status}`)

  const data = await res.json()
  const result = data.chart?.result?.[0]
  if (!result) throw new Error(`No data for ${symbol}`)

  const timestamps: number[] = result.timestamp ?? []
  const quote = result.indicators?.quote?.[0]
  if (!quote) throw new Error(`No price data for ${symbol}`)

  const klines = []
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.close[i] == null) continue
    klines.push({
      time: timestamps[i],
      open: quote.open[i],
      high: quote.high[i],
      low: quote.low[i],
      close: quote.close[i],
      volume: quote.volume[i] ?? 0,
    })
  }

  return klines
}

/**
 * Get the latest price for a symbol.
 */
export async function getPrice(symbol: string): Promise<number> {
  const yahooSymbol = getYahooSymbol(symbol)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=5d`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Price fetch failed for ${symbol}`)

  const data = await res.json()
  const result = data.chart?.result?.[0]
  if (!result) throw new Error(`No data for ${symbol}`)

  const closes = result.indicators?.quote?.[0]?.close ?? []
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] != null) return closes[i]
  }
  throw new Error(`No recent price for ${symbol}`)
}

/**
 * Get the current USD/INR exchange rate.
 */
export async function getUsdInrRate(): Promise<number> {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/INR=X?interval=1d&range=5d'
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error('Failed to fetch USD/INR rate')

  const data = await res.json()
  const result = data.chart?.result?.[0]
  if (!result) throw new Error('No USD/INR data')

  const closes = result.indicators?.quote?.[0]?.close ?? []
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] != null) return closes[i]
  }
  throw new Error('No recent USD/INR rate')
}

/**
 * Get current prices for multiple symbols in one batch.
 */
export async function getPrices(
  symbols: string[]
): Promise<Record<string, number>> {
  const results: Record<string, number> = {}
  await Promise.all(
    symbols.map(async (sym) => {
      try {
        results[sym] = await getPrice(sym)
      } catch {
        // skip
      }
    })
  )
  return results
}
