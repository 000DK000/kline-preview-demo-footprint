import { init } from 'klinecharts'
import { createBinanceFootprintDatafeed } from './binanceFootprintDatafeed'

export default function setupApp (root: HTMLDivElement): void {
  const locale = window.location.hash.endsWith('#en-US') ? 'en-US' : 'zh-CN'

  root.innerHTML = `
    <p class="announcement-bar">
      Footprint demo (Binance • BTCUSDT • 1m)
    </p>
    <div id="container"></div>
  `

  const container = root.querySelector<HTMLDivElement>('#container')
  if (!container) {
    console.error('[preview] #container not found')
    return
  }

  container.style.background = '#FFFFFF'
  container.style.width = '100%'

  try {
    console.log('[preview] boot', { locale })
    console.log('[preview] container size', { w: container.clientWidth, h: container.clientHeight })

    const chart = init(container, {
      locale,
      styles: {
        grid: { show: true },
        candle: { type: 'footprint' }
      }
    })

    if (!chart) {
      console.error('[preview] init() returned null')
      container.innerHTML = '<div style="padding:12px;color:#111">Chart init failed (init returned null). Check container sizing and console errors.</div>'
      return
    }

    chart.setSymbol({ pricePrecision: 2, volumePrecision: 3 })
    chart.setPeriod({ type: 'minute', span: 1 })
    chart.setDataLoader(createBinanceFootprintDatafeed({ symbol: 'BTCUSDT', step: 1, maxBars: 1000, initialBars: 20, pageBars: 20 }))

    chart.createIndicator('VOL', true)
    chart.scrollToRealTime(0)

    console.log('[preview] chart mounted', { children: container.children.length })
  } catch (err) {
    console.error('[preview] fatal error during setup', err)
    container.innerHTML = `<div style="padding:12px;color:#b00020">Fatal error: ${String(err)}</div>`
  }
}

