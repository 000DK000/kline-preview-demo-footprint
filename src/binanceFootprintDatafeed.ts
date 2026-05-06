import type { DataLoader, DataLoaderGetBarsParams, DataLoaderSubscribeBarParams, KLineData, Period } from 'klinecharts'

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

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string
]

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

function periodToBinanceInterval (period: Period): string | null {
  const { span, type } = period
  switch (type) {
    case 'second': return `${span}s`
    case 'minute': return `${span}m`
    case 'hour': return `${span}h`
    case 'day': return `${span}d`
    case 'week': return `${span}w`
    case 'month': return `${span}M`
    default: return null
  }
}

function roundToStep (value: number, step: number): number {
  if (step <= 0) return value
  const factor = 1 / step
  return Math.round(value * factor) / factor
}

function normalizeBinanceTimeMs (value: number): number {
  if (!Number.isFinite(value)) return value
  return value > 10_000_000_000_000 ? Math.floor(value / 1000) : value
}

function alignTimestampToInterval (timestamp: number, intervalMs: number): number {
  return Math.floor(normalizeBinanceTimeMs(timestamp) / intervalMs) * intervalMs
}

function getBaseUrl (): string {
  return import.meta.env.DEV ? '/binance' : 'https://api.binance.com'
}

async function fetchKlines (
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number,
  limit: number
): Promise<BinanceKline[]> {
  const baseUrl = getBaseUrl()
  const url = `${baseUrl}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Binance klines failed: ${res.status} ${res.statusText}`)
  return await res.json() as BinanceKline[]
}

async function fetchAggTrades (symbol: string, startTime: number, endTime: number): Promise<BinanceAggTrade[]> {
  const baseUrl = getBaseUrl()
  const limit = 1000
  const byAggId = new Map<number, BinanceAggTrade>()
  let cursorEnd = endTime
  let guard = 0

  while (cursorEnd >= startTime) {
    guard++
    if (guard > 5000) break

    const url = `${baseUrl}/api/v3/aggTrades?symbol=${encodeURIComponent(symbol)}&startTime=${startTime}&endTime=${cursorEnd}&limit=${limit}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Binance aggTrades failed: ${res.status} ${res.statusText}`)
    const chunk = await res.json() as BinanceAggTrade[]
    if (chunk.length === 0) break

    for (const trade of chunk) {
      trade.T = normalizeBinanceTimeMs(trade.T)
      if (trade.T >= startTime && trade.T <= endTime) {
        byAggId.set(trade.a, trade)
      }
    }

    if (chunk.length < limit) break

    chunk.sort((a, b) => (a.T - b.T) || (a.a - b.a))
    const earliestTradeTime = chunk[0]?.T
    if (!Number.isFinite(earliestTradeTime)) break

    const nextEnd = earliestTradeTime - 1
    if (nextEnd >= cursorEnd) break
    cursorEnd = nextEnd
  }

  return [...byAggId.values()].sort((a, b) => (a.T - b.T) || (a.a - b.a))
}

async function fetchAggTradesChunked (
  symbol: string,
  startTime: number,
  endTime: number,
  intervalMs: number
): Promise<BinanceAggTrade[]> {
  const chunkSpanMs = Math.max(intervalMs, Math.min(intervalMs * 2, 2 * 60_000))
  const trades: BinanceAggTrade[] = []

  for (let chunkStart = startTime; chunkStart <= endTime; chunkStart += chunkSpanMs) {
    const chunkEnd = Math.min(endTime, chunkStart + chunkSpanMs - 1)
    const chunkTrades = await fetchAggTrades(symbol, chunkStart, chunkEnd)
    trades.push(...chunkTrades)
  }

  return trades
}

function buildFootprintLevels (trades: BinanceAggTrade[], step: number): FootprintLevel[] {
  const levelByPrice = new Map<number, { bid: number; ask: number }>()

  for (const trade of trades) {
    const price = Number(trade.p)
    const qty = Number(trade.q)
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue

    const bucket = roundToStep(price, step)
    const level = levelByPrice.get(bucket) ?? { bid: 0, ask: 0 }
    if (trade.m) level.bid += qty
    else level.ask += qty
    levelByPrice.set(bucket, level)
  }

  return [...levelByPrice.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([price, volume]) => ({ price, bid: volume.bid, ask: volume.ask }))
}

async function buildCandlesFromKlines (
  symbol: string,
  klines: BinanceKline[],
  intervalMs: number,
  step: number
): Promise<KLineData[]> {
  const footprints = await Promise.all(
    klines.map(async kline => {
      const openTime = normalizeBinanceTimeMs(kline[0])
      const closeTime = normalizeBinanceTimeMs(kline[6])
      const trades = await fetchAggTradesChunked(symbol, openTime, closeTime, intervalMs)
      return buildFootprintLevels(trades, step)
    })
  )

  return klines
    .map((kline, index) => ({
      timestamp: normalizeBinanceTimeMs(kline[0]),
      open: Number(kline[1]),
      high: Number(kline[2]),
      low: Number(kline[3]),
      close: Number(kline[4]),
      volume: Number(kline[5]),
      footprint: { step, levels: footprints[index] ?? [] }
    }))
    .filter(candle => [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite))
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((candle, index, candles) => candle.timestamp !== candles[index - 1]?.timestamp)
}

export function createBinanceFootprintDatafeed (opts?: {
  symbol?: string
  step?: number
  maxBars?: number
  initialBars?: number
  pageBars?: number
  subscribeIntervalMs?: number
}): DataLoader {
  const symbol = opts?.symbol ?? 'BTCUSDT'
  const step = opts?.step ?? 1
  const maxBars = clamp(opts?.maxBars ?? 3000, 20, 3000)
  const initialBars = clamp(opts?.initialBars ?? Math.min(20, maxBars), 10, maxBars)
  const pageBars = clamp(opts?.pageBars ?? Math.min(20, maxBars), 10, maxBars)
  const subscribeIntervalMs = clamp(opts?.subscribeIntervalMs ?? 2500, 1000, 10_000)

  let timer: number | null = null
  let loadedBars = 0

  const getBars = async (params: DataLoaderGetBarsParams): Promise<void> => {
    const { period, callback, type, timestamp } = params
    const normalizedType = period.type === 'week' || period.type === 'month' || period.type === 'year' ? 'day' : period.type
    const intervalMs = periodToMs(period.span, normalizedType)
    const binanceInterval = periodToBinanceInterval(period)

    if (binanceInterval == null) {
      callback([], false)
      return
    }

    let startTime = 0
    let endTime = 0
    let requestBars = 0

    try {
      if (type === 'init') {
        requestBars = initialBars
        const lastBarOpenTime = alignTimestampToInterval(Date.now(), intervalMs)
        endTime = lastBarOpenTime + intervalMs - 1
        startTime = Math.max(0, endTime - requestBars * intervalMs + 1)
      } else if (type === 'forward') {
        if (!Number.isFinite(timestamp ?? NaN)) {
          callback([], { forward: false })
          return
        }
        requestBars = pageBars
        const boundaryTimestamp = alignTimestampToInterval(timestamp as number, intervalMs)
        endTime = boundaryTimestamp - 1
        startTime = Math.max(0, endTime - requestBars * intervalMs + 1)
      } else if (type === 'backward') {
        callback([], { backward: false })
        return
      } else {
        callback([], false)
        return
      }

      const klines = await fetchKlines(symbol, binanceInterval, startTime, endTime, Math.min(maxBars, requestBars + 1))
      let candles = await buildCandlesFromKlines(symbol, klines, intervalMs, step)
      if (type === 'init') {
        candles = candles.slice(-requestBars)
        loadedBars = candles.length
        callback(candles, { forward: loadedBars < maxBars, backward: false })
        return
      }

      const boundaryTimestamp = timestamp as number
      candles = candles.filter(candle => candle.timestamp < boundaryTimestamp).slice(-requestBars)
      loadedBars = Math.min(maxBars, loadedBars + candles.length)
      callback(candles, { forward: candles.length > 0 && loadedBars < maxBars })
    } catch (err) {
      console.error('[binanceFootprintDatafeed] getBars failed', { symbol, startTime, endTime, intervalMs, type, err })
      callback([], false)
    }
  }

  const subscribeBar = (params: DataLoaderSubscribeBarParams): void => {
    const { period, callback } = params
    const normalizedType = period.type === 'week' || period.type === 'month' || period.type === 'year' ? 'day' : period.type
    const intervalMs = periodToMs(period.span, normalizedType)
    const binanceInterval = periodToBinanceInterval(period)
    if (binanceInterval == null) return

    if (timer != null) window.clearInterval(timer)
    timer = window.setInterval(async () => {
      try {
        const endTime = Date.now()
        const startTime = endTime - intervalMs * 2
        const klines = await fetchKlines(symbol, binanceInterval, startTime, endTime, 3)
        const candles = await buildCandlesFromKlines(symbol, klines, intervalMs, step)
        const last = candles[candles.length - 1]
        if (last != null) callback(last)
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
