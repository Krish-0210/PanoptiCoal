// Time-series loading: the request queue (3 at a time), retries on 503 / 429 / network errors, the
// inline "Couldn't load, retry" state and the session cache.
//   node scripts/check-series.mjs [http://localhost:4173]            faults injected in the browser
//   node scripts/check-series.mjs https://<site> --live [--loads=10]  real loads of the pages that fetch all 11 series
import { chromium } from 'playwright'
const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4173'
const live = args.includes('--live')
const loads = Number(args.find((a) => a.startsWith('--loads='))?.slice(8) ?? 10)
const isSeries = (u) => /timeseries/.test(u)
let failed = 0
const check = (name, ok, extra = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}
const mapState = (p) =>
  p.evaluate(() => ({ sparks: document.querySelectorAll('.rank-spark svg').length, fails: document.querySelectorAll('.rank-spark .load-retry').length, cards: document.querySelectorAll('.rank-item').length }))
const hiwState = (p) =>
  p.evaluate(() => ({ chart: !!document.querySelector('.nvm-explain'), fail: !!document.querySelector('.loading .load-retry'), loading: /Loading the 11 clusters/.test(document.querySelector('main')?.innerText ?? '') }))
const settle = (p, fn, done, ms = 30000) =>
  p.waitForFunction(done, null, { timeout: ms }).then(() => fn(p), () => fn(p))
const mapDone = () => document.querySelectorAll('.rank-item').length > 0 && document.querySelectorAll('.rank-spark svg').length + document.querySelectorAll('.rank-spark .load-retry').length === document.querySelectorAll('.rank-item').length
const hiwDone = () => !!document.querySelector('.nvm-explain') || !!document.querySelector('.loading .load-retry')

const b = await chromium.launch({ channel: 'chrome' })

if (live) {
  // Each load is a fresh profile (empty cache), a few seconds apart.
  for (const [path, state, done, ok] of [
    ['/map', mapState, mapDone, (s) => s.sparks === 11 && s.fails === 0],
    ['/how-it-works', hiwState, hiwDone, (s) => s.chart && !s.fail],
  ]) {
    let good = 0, busy = 0, requests = 0
    for (let i = 0; i < loads; i++) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
      const p = await ctx.newPage()
      p.on('response', (r) => {
        if (!isSeries(r.url()) && !/\/clusters\//.test(r.url())) return
        requests++
        if (r.status() === 503 || r.status() === 429) busy++
      })
      await p.goto(base + path, { waitUntil: 'domcontentloaded' })
      const s = await settle(p, state, done, 45000)
      if (ok(s)) good++
      else console.log(`      load ${i + 1}: ${JSON.stringify(s)}`)
      await ctx.close()
      await new Promise((r) => setTimeout(r, 4000))
    }
    check(`${path}: every series loaded in ${good} of ${loads} loads`, good === loads, `${busy} busy answers (503/429) among ${requests} cluster requests, all retried`)
  }
} else {
  // 1. Queue: never more than 3 series requests in flight.
  {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
    let open = 0, peak = 0, total = 0
    await p.route(isSeries_, async (route) => {
      open++
      total++
      peak = Math.max(peak, open)
      await new Promise((r) => setTimeout(r, 150))
      open--
      await route.continue()
    })
    await p.goto(`${base}/map`, { waitUntil: 'domcontentloaded' })
    const s = await settle(p, mapState, mapDone)
    check('queue: 11 sparklines, at most 3 series requests at a time', s.sparks === 11 && peak <= 3 && total === 11, `peak ${peak}, ${total} requests`)
    // 2. Session cache: another page that needs all 11, then back, without new requests.
    await p.click('a[href="/how-it-works"]')
    const h = await settle(p, hiwState, hiwDone)
    await p.click('a[href="/map"]')
    const s2 = await settle(p, mapState, mapDone)
    check('cache: revisiting pages refetches nothing', h.chart && s2.sparks === 11 && total === 11, `${total} series requests in all`)
    await p.close()
  }
  // 3. Retry: every series answers 503 twice (and one drops the connection once), then succeeds.
  {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
    const seen = new Map()
    const gaps = []
    await p.route(isSeries_, async (route) => {
      const u = route.request().url()
      const n = (seen.get(u)?.n ?? 0) + 1
      const now = Date.now()
      if (seen.has(u)) gaps.push(now - seen.get(u).t)
      seen.set(u, { n, t: now })
      if (n === 1 && /talcher/.test(u)) return route.abort('connectionreset')
      if (n <= 2) return route.fulfill({ status: n === 1 ? 503 : 429, body: 'busy' })
      return route.continue()
    })
    await p.goto(`${base}/map`, { waitUntil: 'domcontentloaded' })
    const s = await settle(p, mapState, mapDone)
    check('retry: 503, 429 and a dropped connection all recover', s.sparks === 11 && s.fails === 0, JSON.stringify(s))
    check('retry: backoff between tries', Math.min(...gaps) >= 200 && Math.max(...gaps) <= 1400, `gaps ${Math.min(...gaps)}–${Math.max(...gaps)} ms`)
    await p.close()
  }
  // 4. Still failing after 3 retries: an inline retry on that card only, and on the charts.
  {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    let down = true, tries = 0
    await p.route(isSeries_, (route) => {
      if (!down || !/korba/.test(route.request().url())) return route.continue()
      tries++
      return route.fulfill({ status: 503, body: 'busy' })
    })
    await p.goto(`${base}/map`, { waitUntil: 'domcontentloaded' })
    let s = await settle(p, mapState, mapDone)
    const text = await p.evaluate(() => document.querySelector('.rank-spark .load-retry')?.textContent)
    check('failure: one card shows "Couldn’t load, retry", the other 10 load', s.sparks === 10 && s.fails === 1 && tries === 4 && /Couldn’t load, retry/.test(text ?? ''), `${JSON.stringify(s)}, ${tries} tries, "${text}"`)
    await p.goto(`${base}/how-it-works`, { waitUntil: 'domcontentloaded' })
    let h = await settle(p, hiwState, hiwDone)
    check('failure: the comparison chart shows the retry, page intact', h.fail && !h.chart && (await p.evaluate(() => document.querySelector('main').innerText.length)) > 2000, JSON.stringify(h))
    await p.goto(`${base}/cluster/korba`, { waitUntil: 'domcontentloaded' })
    await p.waitForSelector('.tab-panel .load-retry', { timeout: 20000 }).catch(() => {})
    check('failure: the cluster page charts show the retry', await p.evaluate(() => !!document.querySelector('.tab-panel .load-retry') && !!document.querySelector('h1')))
    down = false
    await p.click('.tab-panel .load-retry-btn')
    await p.waitForSelector('.tab-panel .recharts-wrapper', { timeout: 20000 }).catch(() => {})
    check('retry control: cluster charts load', await p.evaluate(() => !!document.querySelector('.tab-panel .recharts-wrapper') && !document.querySelector('.tab-panel .load-retry')))
    down = true
    await p.goto(`${base}/map`, { waitUntil: 'domcontentloaded' })
    s = await settle(p, mapState, mapDone)
    down = false
    const url = p.url()
    await p.click('.rank-spark .load-retry-btn')
    s = await settle(p, mapState, () => document.querySelectorAll('.rank-spark svg').length === 11, 15000)
    check('retry control: the card loads and the click does not open the cluster', s.sparks === 11 && s.fails === 0 && p.url() === url, JSON.stringify(s))
    check('failure: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await p.close()
  }
}
await b.close()
console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)

function isSeries_(u) {
  return isSeries(u.href)
}
