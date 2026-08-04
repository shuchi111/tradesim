export interface Instrument {
  symbol: string
  yahooSymbol: string
  label: string
  base: string
  currency: 'INR'
  exchange: string
  sector: string
  index: string
}

export const INSTRUMENTS: Instrument[] = [
  { symbol: 'NIFTY50', yahooSymbol: '%5ENSEI', label: 'Nifty 50 Index', base: 'NIFTY', currency: 'INR', exchange: 'NSE', sector: 'Index', index: 'INDEX' },
  { symbol: 'RELIANCE', yahooSymbol: 'RELIANCE.NS', label: 'Reliance Industries', base: 'RELIANCE', currency: 'INR', exchange: 'NSE', sector: 'Energy', index: 'NIFTY50' },
  { symbol: 'TCS', yahooSymbol: 'TCS.NS', label: 'Tata Consultancy Services', base: 'TCS', currency: 'INR', exchange: 'NSE', sector: 'IT', index: 'NIFTY50' },
  { symbol: 'HDFCBANK', yahooSymbol: 'HDFCBANK.NS', label: 'HDFC Bank', base: 'HDFCBANK', currency: 'INR', exchange: 'NSE', sector: 'Banking', index: 'NIFTY50' },
  { symbol: 'INFY', yahooSymbol: 'INFY.NS', label: 'Infosys', base: 'INFY', currency: 'INR', exchange: 'NSE', sector: 'IT', index: 'NIFTY50' },
  { symbol: 'ICICIBANK', yahooSymbol: 'ICICIBANK.NS', label: 'ICICI Bank', base: 'ICICIBANK', currency: 'INR', exchange: 'NSE', sector: 'Banking', index: 'NIFTY50' },
  { symbol: 'HINDUNILVR', yahooSymbol: 'HINDUNILVR.NS', label: 'Hindustan Unilever', base: 'HINDUNILVR', currency: 'INR', exchange: 'NSE', sector: 'FMCG', index: 'NIFTY50' },
  { symbol: 'ITC', yahooSymbol: 'ITC.NS', label: 'ITC Limited', base: 'ITC', currency: 'INR', exchange: 'NSE', sector: 'FMCG', index: 'NIFTY50' },
  { symbol: 'SBIN', yahooSymbol: 'SBIN.NS', label: 'State Bank of India', base: 'SBIN', currency: 'INR', exchange: 'NSE', sector: 'Banking', index: 'NIFTY50' },
  { symbol: 'BHARTIARTL', yahooSymbol: 'BHARTIARTL.NS', label: 'Bharti Airtel', base: 'BHARTIARTL', currency: 'INR', exchange: 'NSE', sector: 'Telecom', index: 'NIFTY50' },
  { symbol: 'KOTAKBANK', yahooSymbol: 'KOTAKBANK.NS', label: 'Kotak Mahindra Bank', base: 'KOTAKBANK', currency: 'INR', exchange: 'NSE', sector: 'Banking', index: 'NIFTY50' },
  { symbol: 'LT', yahooSymbol: 'LT.NS', label: 'Larsen and Toubro', base: 'LT', currency: 'INR', exchange: 'NSE', sector: 'Construction', index: 'NIFTY50' },
  { symbol: 'AXISBANK', yahooSymbol: 'AXISBANK.NS', label: 'Axis Bank', base: 'AXISBANK', currency: 'INR', exchange: 'NSE', sector: 'Banking', index: 'NIFTY50' },
  { symbol: 'ASIANPAINT', yahooSymbol: 'ASIANPAINT.NS', label: 'Asian Paints', base: 'ASIANPAINT', currency: 'INR', exchange: 'NSE', sector: 'Consumer', index: 'NIFTY50' },
  { symbol: 'MARUTI', yahooSymbol: 'MARUTI.NS', label: 'Maruti Suzuki', base: 'MARUTI', currency: 'INR', exchange: 'NSE', sector: 'Auto', index: 'NIFTY50' },
  { symbol: 'TITAN', yahooSymbol: 'TITAN.NS', label: 'Titan Company', base: 'TITAN', currency: 'INR', exchange: 'NSE', sector: 'Consumer', index: 'NIFTY50' },
  { symbol: 'SUNPHARMA', yahooSymbol: 'SUNPHARMA.NS', label: 'Sun Pharmaceutical', base: 'SUNPHARMA', currency: 'INR', exchange: 'NSE', sector: 'Pharma', index: 'NIFTY50' },
  { symbol: 'ULTRACEMCO', yahooSymbol: 'ULTRACEMCO.NS', label: 'UltraTech Cement', base: 'ULTRACEMCO', currency: 'INR', exchange: 'NSE', sector: 'Cement', index: 'NIFTY50' },
  { symbol: 'NESTLEIND', yahooSymbol: 'NESTLEIND.NS', label: 'Nestle India', base: 'NESTLEIND', currency: 'INR', exchange: 'NSE', sector: 'FMCG', index: 'NIFTY50' },
  { symbol: 'BAJFINANCE', yahooSymbol: 'BAJFINANCE.NS', label: 'Bajaj Finance', base: 'BAJFINANCE', currency: 'INR', exchange: 'NSE', sector: 'NBFC', index: 'NIFTY50' },
  { symbol: 'NTPC', yahooSymbol: 'NTPC.NS', label: 'NTPC Limited', base: 'NTPC', currency: 'INR', exchange: 'NSE', sector: 'Power', index: 'NIFTY50' },
  { symbol: 'POWERGRID', yahooSymbol: 'POWERGRID.NS', label: 'Power Grid Corporation', base: 'POWERGRID', currency: 'INR', exchange: 'NSE', sector: 'Power', index: 'NIFTY50' },
  { symbol: 'TATAMOTORS', yahooSymbol: 'TATAMOTORS.NS', label: 'Tata Motors', base: 'TATAMOTORS', currency: 'INR', exchange: 'NSE', sector: 'Auto', index: 'NIFTY50' },
  { symbol: 'ONGC', yahooSymbol: 'ONGC.NS', label: 'Oil and Natural Gas Corp', base: 'ONGC', currency: 'INR', exchange: 'NSE', sector: 'Energy', index: 'NIFTY50' },
  { symbol: 'ADANIENT', yahooSymbol: 'ADANIENT.NS', label: 'Adani Enterprises', base: 'ADANIENT', currency: 'INR', exchange: 'NSE', sector: 'Conglomerate', index: 'NIFTY50' },
  { symbol: 'TATASTEEL', yahooSymbol: 'TATASTEEL.NS', label: 'Tata Steel', base: 'TATASTEEL', currency: 'INR', exchange: 'NSE', sector: 'Metal', index: 'NIFTY50' },
  { symbol: 'JSWSTEEL', yahooSymbol: 'JSWSTEEL.NS', label: 'JSW Steel', base: 'JSWSTEEL', currency: 'INR', exchange: 'NSE', sector: 'Metal', index: 'NIFTY50' },
  { symbol: 'WIPRO', yahooSymbol: 'WIPRO.NS', label: 'Wipro', base: 'WIPRO', currency: 'INR', exchange: 'NSE', sector: 'IT', index: 'NIFTY50' },
  { symbol: 'HCLTECH', yahooSymbol: 'HCLTECH.NS', label: 'HCL Technologies', base: 'HCLTECH', currency: 'INR', exchange: 'NSE', sector: 'IT', index: 'NIFTY50' },
  { symbol: 'COALINDIA', yahooSymbol: 'COALINDIA.NS', label: 'Coal India', base: 'COALINDIA', currency: 'INR', exchange: 'NSE', sector: 'Mining', index: 'NIFTY50' },
  { symbol: 'GRASIM', yahooSymbol: 'GRASIM.NS', label: 'Grasim Industries', base: 'GRASIM', currency: 'INR', exchange: 'NSE', sector: 'Cement', index: 'NIFTY50' },
  { symbol: 'TECHM', yahooSymbol: 'TECHM.NS', label: 'Tech Mahindra', base: 'TECHM', currency: 'INR', exchange: 'NSE', sector: 'IT', index: 'NIFTY50' },
  { symbol: 'INDUSINDBK', yahooSymbol: 'INDUSINDBK.NS', label: 'IndusInd Bank', base: 'INDUSINDBK', currency: 'INR', exchange: 'NSE', sector: 'Banking', index: 'NIFTY50' },
  { symbol: 'DRREDDY', yahooSymbol: 'DRREDDY.NS', label: 'Dr Reddys Laboratories', base: 'DRREDDY', currency: 'INR', exchange: 'NSE', sector: 'Pharma', index: 'NIFTY50' },
  { symbol: 'CIPLA', yahooSymbol: 'CIPLA.NS', label: 'Cipla', base: 'CIPLA', currency: 'INR', exchange: 'NSE', sector: 'Pharma', index: 'NIFTY50' },
  { symbol: 'BAJAJFINSV', yahooSymbol: 'BAJAJFINSV.NS', label: 'Bajaj Finserv', base: 'BAJAJFINSV', currency: 'INR', exchange: 'NSE', sector: 'NBFC', index: 'NIFTY50' },
  { symbol: 'EICHERMOT', yahooSymbol: 'EICHERMOT.NS', label: 'Eicher Motors', base: 'EICHERMOT', currency: 'INR', exchange: 'NSE', sector: 'Auto', index: 'NIFTY50' },
  { symbol: 'BPCL', yahooSymbol: 'BPCL.NS', label: 'Bharat Petroleum', base: 'BPCL', currency: 'INR', exchange: 'NSE', sector: 'Energy', index: 'NIFTY50' },
  { symbol: 'HDFCLIFE', yahooSymbol: 'HDFCLIFE.NS', label: 'HDFC Life Insurance', base: 'HDFCLIFE', currency: 'INR', exchange: 'NSE', sector: 'Insurance', index: 'NIFTY50' },
  { symbol: 'SBILIFE', yahooSymbol: 'SBILIFE.NS', label: 'SBI Life Insurance', base: 'SBILIFE', currency: 'INR', exchange: 'NSE', sector: 'Insurance', index: 'NIFTY50' },
  { symbol: 'BRITANNIA', yahooSymbol: 'BRITANNIA.NS', label: 'Britannia Industries', base: 'BRITANNIA', currency: 'INR', exchange: 'NSE', sector: 'FMCG', index: 'NIFTY50' },
  { symbol: 'DIVISLAB', yahooSymbol: 'DIVISLAB.NS', label: 'Divis Laboratories', base: 'DIVISLAB', currency: 'INR', exchange: 'NSE', sector: 'Pharma', index: 'NIFTY50' },
  { symbol: 'HEROMOTOCO', yahooSymbol: 'HEROMOTOCO.NS', label: 'Hero MotoCorp', base: 'HEROMOTOCO', currency: 'INR', exchange: 'NSE', sector: 'Auto', index: 'NIFTY50' },
  { symbol: 'ADANIPORTS', yahooSymbol: 'ADANIPORTS.NS', label: 'Adani Ports and SEZ', base: 'ADANIPORTS', currency: 'INR', exchange: 'NSE', sector: 'Infrastructure', index: 'NIFTY50' },
  { symbol: 'BAJAJ-AUTO', yahooSymbol: 'BAJAJ-AUTO.NS', label: 'Bajaj Auto', base: 'BAJAJ-AUTO', currency: 'INR', exchange: 'NSE', sector: 'Auto', index: 'NIFTY50' },
  { symbol: 'UPL', yahooSymbol: 'UPL.NS', label: 'UPL Limited', base: 'UPL', currency: 'INR', exchange: 'NSE', sector: 'Chemicals', index: 'NIFTY50' },
  { symbol: 'SHRIRAMFIN', yahooSymbol: 'SHRIRAMFIN.NS', label: 'Shriram Finance', base: 'SHRIRAMFIN', currency: 'INR', exchange: 'NSE', sector: 'NBFC', index: 'NIFTY50' },
  { symbol: 'TATACONSUM', yahooSymbol: 'TATACONSUM.NS', label: 'Tata Consumer Products', base: 'TATACONSUM', currency: 'INR', exchange: 'NSE', sector: 'FMCG', index: 'NIFTY50' },
  { symbol: 'LTIM', yahooSymbol: 'LTIM.NS', label: 'LTIMindtree', base: 'LTIM', currency: 'INR', exchange: 'NSE', sector: 'IT', index: 'NIFTY50' },
  { symbol: 'PNB', yahooSymbol: 'PNB.NS', label: 'Punjab National Bank', base: 'PNB', currency: 'INR', exchange: 'NSE', sector: 'Banking', index: 'NIFTY50' },
  { symbol: 'MM', yahooSymbol: 'M%26M.NS', label: 'Mahindra and Mahindra', base: 'M and M', currency: 'INR', exchange: 'NSE', sector: 'Auto', index: 'NIFTY50' },
  { symbol: 'ZOMATO', yahooSymbol: 'ZOMATO.NS', label: 'Zomato (Eternal Ltd)', base: 'ZOMATO', currency: 'INR', exchange: 'NSE', sector: 'Tech', index: 'NIFTY50' },
  { symbol: 'JIOFIN', yahooSymbol: 'JIOFIN.NS', label: 'Jio Financial Services', base: 'JIOFIN', currency: 'INR', exchange: 'NSE', sector: 'NBFC', index: 'NIFTY50' },
]

export function getInstrument(symbol: string): Instrument | undefined {
  return INSTRUMENTS.find((s) => s.symbol === symbol)
}

export function getYahooSymbol(symbol: string): string {
  return getInstrument(symbol)?.yahooSymbol ?? symbol
}

export const NIFTY50_STOCKS = INSTRUMENTS.filter((s) => s.index === 'NIFTY50')
export const TRADABLE_INSTRUMENTS = INSTRUMENTS.filter((s) => s.index !== 'INDEX')

export const TIMEFRAMES = [
  { value: '15m', label: '15m' },
  { value: '60m', label: '1H' },
  { value: '1d', label: '1D' },
  { value: '1wk', label: '1W' },
] as const

export const STARTING_BALANCE_INR = 100000

export interface AccountData {
  balance: number
  startingEquity: number
  equity: number
  positionsValue: number
  sipAmountInr: number
  sipDayOfMonth?: number
  sipEligibleFrom?: string | null
  lastSipDate: string | null
}

export interface StrategySignal {
  instrument: string
  signal: 'BUY' | 'SELL' | 'HOLD'
  reason: string
  price: number
  confidence: number
  indicators: { sma5: number; sma20: number; rsi14: number; volume: number }
}

export interface PositionData {
  id: number
  symbol: string
  side: string
  entryPrice: number
  quantity: number
  createdAt: string
}

export interface OrderData {
  id: number
  symbol: string
  side: string
  type: string
  price: number
  quantity: number
  status: string
  createdAt: string
}

export interface TradeData {
  id: number
  symbol: string
  side: string
  price: number
  quantity: number
  createdAt: string
}

export interface ClosedPositionData {
  id: number
  symbol: string
  side: string
  entryPrice: number
  exitPrice: number
  quantity: number
  pnl: number
  openedAt: string
  closedAt: string
}

export interface BacktestResult {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  totalReturn: number
  maxDrawdown: number
  expectancy: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  cagr: number
  sharpe: number
  trades: Array<{
    entryDate: string
    exitDate: string
    entryPrice: number
    exitPrice: number
    quantity: number
    pnl: number
    returnPct: number
  }>
  equityCurve: Array<{ date: string; equity: number }>
}
