'use client'

import { useEffect, useRef, useState } from 'react'
import { useCurrency } from '@/lib/currency'
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { TIMEFRAMES, getInstrument } from '@/types'

interface ChartProps {
  symbol: string
  timeframe: string
  onTimeframeChange: (tf: string) => void
}

interface Kline {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export default function Chart({ symbol, timeframe, onTimeframeChange }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const [lastPrice, setLastPrice] = useState(0)
  const inst = getInstrument(symbol)

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0e0f14' },
        textColor: '#8b8fa3',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: '#1e1f2b' },
        horzLines: { color: '#1e1f2b' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#4a4d62', width: 1, style: 3 },
        horzLine: { color: '#4a4d62', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: '#2a2c3e',
        scaleMargins: { top: 0.1, bottom: 0.3 },
      },
      timeScale: {
        borderColor: '#2a2c3e',
        timeVisible: timeframe === '15m' || timeframe === '60m',
        secondsVisible: false,
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    })

    chartRef.current = chart

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })
    candleSeriesRef.current = candleSeries

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })
    volumeSeriesRef.current = volumeSeries

    const resizeObserver = new ResizeObserver(() => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        })
      }
    })
    resizeObserver.observe(chartContainerRef.current)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [])

  // Load historical data when symbol/timeframe changes
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return

    let mounted = true

    const loadData = async () => {
      try {
        const res = await fetch(`/api/klines/${symbol}/${timeframe}`)
        const json = await res.json()
        if (!mounted || !json.data) return

        const klines: Kline[] = json.data

        candleSeriesRef.current!.setData(
          klines.map((k) => ({
            time: k.time as UTCTimestamp,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
          }))
        )

        volumeSeriesRef.current!.setData(
          klines.map((k) => ({
            time: k.time as UTCTimestamp,
            value: k.volume,
            color: k.close >= k.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
          }))
        )

        if (klines.length > 0) setLastPrice(klines[klines.length - 1].close)
        chartRef.current?.timeScale().fitContent()
      } catch {
        // Silent fail
      }
    }

    loadData()
    return () => {
      mounted = false
    }
  }, [symbol, timeframe])

  // Poll for live price updates (Yahoo Finance has no free WS)
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/ticker/${symbol}`)
        const json = await res.json()
        if (json.data && candleSeriesRef.current) {
          const price = json.data.nativePrice
          if (price !== lastPrice) {
            setLastPrice(price)
            // Update the last candle's close
            candleSeriesRef.current.applyOptions({
              priceFormat: { type: 'price', precision: price < 1 ? 4 : 2, minMove: price < 1 ? 0.0001 : 0.01 },
            })
          }
        }
      } catch {
        // ignore
      }
    }

    poll()
    const interval = setInterval(poll, 15000) // poll every 15s
    return () => clearInterval(interval)
  }, [symbol, lastPrice])

  const { fmt } = useCurrency()
  const fmtPrice = (p: number) => fmt(p, { decimals: 2 })

  return (
    <div className="flex flex-1 flex-col">
      {/* Timeframe bar */}
      <div className="flex items-center gap-1 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.value}
            onClick={() => onTimeframeChange(tf.value)}
            className={`rounded px-3 py-1 text-xs font-medium ${
              timeframe === tf.value
                ? 'bg-[var(--bg-hover)] text-[var(--blue)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tf.label}
          </button>
        ))}
        {lastPrice > 0 && (
          <span className="ml-auto mr-2 text-xs text-[var(--text-secondary)]">
            Last: <span className="font-medium text-[var(--text-primary)]">{fmtPrice(lastPrice)}</span>
          </span>
        )}
      </div>
      <div ref={chartContainerRef} className="flex-1" />
    </div>
  )
}
