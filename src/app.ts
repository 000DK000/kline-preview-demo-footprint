import { init, type Period } from 'klinecharts'
import { createBinanceFootprintDatafeed } from './binanceFootprintDatafeed'

type TimeframeOption = {
  label: string
  value: string
  period: Period
  defaultStep: number
  barSpace: number
  initialBars: number
  pageBars: number
}

const TIMEFRAME_OPTIONS: TimeframeOption[] = [
  { label: '1m', value: '1m', period: { type: 'minute', span: 1 }, defaultStep: 10, barSpace: 46, initialBars: 10, pageBars: 10 },
  { label: '3m', value: '3m', period: { type: 'minute', span: 3 }, defaultStep: 10, barSpace: 42, initialBars: 12, pageBars: 12 },
  { label: '5m', value: '5m', period: { type: 'minute', span: 5 }, defaultStep: 10, barSpace: 40, initialBars: 14, pageBars: 14 },
  { label: '15m', value: '15m', period: { type: 'minute', span: 15 }, defaultStep: 25, barSpace: 36, initialBars: 16, pageBars: 16 },
  { label: '1h', value: '1h', period: { type: 'hour', span: 1 }, defaultStep: 50, barSpace: 34, initialBars: 18, pageBars: 18 }
]

const STEP_OPTIONS = [1, 5, 10, 25, 50, 100]

export default function setupApp (root: HTMLDivElement): void {
  const locale = window.location.hash.endsWith('#en-US') ? 'en-US' : 'zh-CN'
  let selectedTimeframe = TIMEFRAME_OPTIONS[0]
  let selectedStep = selectedTimeframe.defaultStep

  root.innerHTML = `
    <div class="toolbar">
      <p class="announcement-bar">Footprint demo (Binance • BTCUSDT)</p>
      <div class="toolbar-controls">
        <label class="toolbar-field">
          <span>Timeframe</span>
          <select id="timeframe-select"></select>
        </label>
        <label class="toolbar-field">
          <span>Step</span>
          <select id="step-select"></select>
        </label>
      </div>
    </div>
    <div id="container"></div>
  `

  const container = root.querySelector<HTMLDivElement>('#container')
  const timeframeSelect = root.querySelector<HTMLSelectElement>('#timeframe-select')
  const stepSelect = root.querySelector<HTMLSelectElement>('#step-select')
  if (!container) {
    console.error('[preview] #container not found')
    return
  }
  if (!timeframeSelect || !stepSelect) {
    console.error('[preview] controls not found')
    return
  }

  timeframeSelect.innerHTML = TIMEFRAME_OPTIONS
    .map(option => `<option value="${option.value}">${option.label}</option>`)
    .join('')
  stepSelect.innerHTML = STEP_OPTIONS
    .map(step => `<option value="${step}">${step}</option>`)
    .join('')
  timeframeSelect.value = selectedTimeframe.value
  stepSelect.value = String(selectedStep)

  container.style.background = '#FFFFFF'
  container.style.width = '100%'

  try {
    console.log('[preview] boot', { locale })
    console.log('[preview] container size', { w: container.clientWidth, h: container.clientHeight })

    const chart = init(container, {
      locale,
      styles: {
        grid: { show: true },
        candle: {
          type: 'footprint',
          footprint: {
            padding: 2,
            columnGap: 2,
            minAlpha: 0.22,
            maxAlpha: 0.96,
            bidColor: '#E35D6A',
            askColor: '#4EA88E',
            textColor: '#FFFFFF',
            textColorLight: '#1C2430',
            fontSize: 12,
            fontFamily: 'Segoe UI',
            fontWeight: '600',
            pocColor: '#111111'
          }
        }
      }
    })

    if (!chart) {
      console.error('[preview] init() returned null')
      container.innerHTML = '<div style="padding:12px;color:#111">Chart init failed (init returned null). Check container sizing and console errors.</div>'
      return
    }

    chart.setSymbol({ pricePrecision: 2, volumePrecision: 3 })

    const applySettings = (): void => {
      chart.setDataLoader(createBinanceFootprintDatafeed({
        symbol: 'BTCUSDT',
        step: selectedStep,
        maxBars: 3000,
        initialBars: selectedTimeframe.initialBars,
        pageBars: selectedTimeframe.pageBars
      }))
      chart.setPeriod(selectedTimeframe.period)
      chart.setBarSpace(selectedTimeframe.barSpace)
      chart.scrollToRealTime(0)
    }

    timeframeSelect.addEventListener('change', () => {
      const nextTimeframe = TIMEFRAME_OPTIONS.find(option => option.value === timeframeSelect.value)
      if (nextTimeframe == null) return
      selectedTimeframe = nextTimeframe
      selectedStep = nextTimeframe.defaultStep
      stepSelect.value = String(selectedStep)
      applySettings()
    })

    stepSelect.addEventListener('change', () => {
      const nextStep = Number(stepSelect.value)
      if (!Number.isFinite(nextStep) || nextStep <= 0) return
      selectedStep = nextStep
      applySettings()
    })

    applySettings()
    chart.createIndicator('VOL', true)

    console.log('[preview] chart mounted', { children: container.children.length })
  } catch (err) {
    console.error('[preview] fatal error during setup', err)
    container.innerHTML = `<div style="padding:12px;color:#b00020">Fatal error: ${String(err)}</div>`
  }
}
