import type { DataLoader, DataLoaderGetBarsParams, DataLoaderSubscribeBarParams, KLineData } from 'klinecharts'

type BinanceAggTrade = {
  a: number
  p: string
  q: string
  f: number
  l: number
  T: number
  m: boolean
  M: boolean
}

type FootprintLevel = { price: number; bid: number; ask: number }

export type FootprintPayload = {
  step: number
  levels: FootprintLevel[]
}

function clamp (value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function periodToMs (span: number, type: 'second' | 'minute' | 'hour' | 'day'): number {
  switch (type) {
    case 'second': return span * 1000
    case 'minute': return span * 60_000
    case 'hour': return span * 3_600_000
    case 'day': return span * 86_400_000
  }
}

function roundToStep (value: number, step: number): number {
  if (step <= 0) return value
  const factor = 1 / step
  return Math.round(value * factor) / factor
}

async function fetchAggTrades (symbol: string, startTime: number, endTime: number): Promise<BinanceAggTrade[]> {
  const baseUrl = import.meta.env.DEV ? '/binance' : 'https://api.binance.com'
  const all: BinanceAggTrade[] = []
  let cursor = startTime
  while (cursor < endTime) {
    const url = `${baseUrl}/api/v3/aggTrades?symbol=${encodeURIComponent(symbol)}&startTime=${cursor}&endTime=${endTime}&limit=1000`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Binance aggTrades failed: ${res.status} ${res.statusText}`)
    const chunk = (await res.json()) as BinanceAggTrade[]
    if (chunk.length === 0) break
    all.push(...chunk)
    const lastT = chunk[chunk.length - 1]!.T
    if (lastT >= endTime - 1) break
    if (chunk.length < 1000) break
    cursor = lastT + 1
  }
  return all
}

function buildCandlesFromTrades (
  trades: BinanceAggTrade[],
  intervalMs: number,
  step: number
): KLineData[] {
  const byTs = new Map<number, {
    ts: number
    open: number
    high: number
    low: number
    close: number
    volume: number
    levels: Map<number, { bid: number; ask: number }>
  }>()

  for (const t of trades) {
    const price = Number(t.p)
    const qty = Number(t.q)
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue

    const ts = Math.floor(t.T / intervalMs) * intervalMs
    let candle = byTs.get(ts)
    if (!candle) {
      candle = {
        ts,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        levels: new Map()
      }
      byTs.set(ts, candle)
    }

    candle.high = Math.max(candle.high, price)
    candle.low = Math.min(candle.low, price)
    candle.close = price
    candle.volume += qty

    const bucket = roundToStep(price, step)
    const level = candle.levels.get(bucket) ?? { bid: 0, ask: 0 }
    // Binance: m=true means buyer is the maker => trade initiated by seller (treat as bid/sell volume).
    if (t.m) level.bid += qty
    else level.ask += qty
    candle.levels.set(bucket, level)
  }

  return [...byTs.values()]
    .sort((a, b) => a.ts - b.ts)
    .map(c => {
      const levels: FootprintLevel[] = [...c.levels.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([price, v]) => ({ price, bid: v.bid, ask: v.ask }))

      const footprint: FootprintPayload = { step, levels }
      return {
        timestamp: c.ts,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        footprint
      }
    })
}

export function createBinanceFootprintDatafeed (opts?: {
  symbol?: string
  step?: number
  maxBars?: number
  subscribeIntervalMs?: number
}): DataLoader {
  const symbol = opts?.symbol ?? 'BTCUSDT'
  const step = opts?.step ?? 1
  const maxBars = clamp(opts?.maxBars ?? 120, 20, 500)
  const subscribeIntervalMs = clamp(opts?.subscribeIntervalMs ?? 2500, 1000, 10_000)

  let timer: number | null = null

  const getBars = async (params: DataLoaderGetBarsParams): Promise<void> => {
    const { period, callback, type } = params
    const intervalMs = periodToMs(period.span, period.type === 'week' || period.type === 'month' || period.type === 'year' ? 'day' : period.type)
    const endTime = Date.now()
    const startTime = endTime - maxBars * intervalMs
    try {
      const trades = await fetchAggTrades(symbol, startTime, endTime)
      callback(buildCandlesFromTrades(trades, intervalMs, step), false)
    } catch (err) {
      console.error('[binanceFootprintDatafeed] getBars failed', { symbol, startTime, endTime, intervalMs, type, err })
      callback([], false)
    }
  }

  const subscribeBar = (params: DataLoaderSubscribeBarParams): void => {
    const { period, callback } = params
    const intervalMs = periodToMs(period.span, period.type === 'week' || period.type === 'month' || period.type === 'year' ? 'day' : period.type)
    if (timer != null) window.clearInterval(timer)
    timer = window.setInterval(async () => {
      try {
        const endTime = Date.now()
        const startTime = endTime - intervalMs
        const trades = await fetchAggTrades(symbol, startTime, endTime)
        const candles = buildCandlesFromTrades(trades, intervalMs, step)
        const last = candles[candles.length - 1]
        if (last) callback(last)
      } catch (err) {
        console.warn('[binanceFootprintDatafeed] subscribeBar tick failed', { symbol, intervalMs, err })
      }
    }, subscribeIntervalMs)
  }

  const unsubscribeBar = (): void => {
    if (timer != null) {
      window.clearInterval(timer)
      timer = null
    }
  }

  return { getBars, subscribeBar, unsubscribeBar }
}
