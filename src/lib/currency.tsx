'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface CurrencyContextValue {
  /** Format an INR amount with Indian locale & compact L/Cr notation */
  fmt: (amount: number, opts?: { decimals?: number; compact?: boolean }) => string
  /** Format a number with ₹ prefix, no conversion (for prices already in INR) */
  fmtRaw: (amount: number, opts?: { decimals?: number }) => string
  /** Identity passthrough — amounts are already INR */
  convert: (amount: number) => number
  /** Currency symbol */
  symbol: string
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const symbol = '₹'

  const convert = useCallback((amount: number): number => {
    return amount
  }, [])

  const fmt = useCallback((amount: number, opts?: { decimals?: number; compact?: boolean }): string => {
    const decimals = opts?.decimals ?? 2
    const compact = opts?.compact ?? false

    if (compact && Math.abs(amount) >= 100000) {
      if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`
      if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`
    }

    return `${symbol}${amount.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
  }, [])

  const fmtRaw = useCallback((amount: number, opts?: { decimals?: number }): string => {
    const decimals = opts?.decimals ?? 2
    return `${symbol}${amount.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
  }, [])

  return (
    <CurrencyContext.Provider value={{ fmt, fmtRaw, convert, symbol }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider')
  return ctx
}

/** Helper for sign-prefixed P&L formatting */
export function fmtPnl(amount: number, fmt: (n: number, opts?: { decimals?: number }) => string): string {
  const sign = amount >= 0 ? '+' : '-'
  return `${sign}${fmt(Math.abs(amount))}`
}
