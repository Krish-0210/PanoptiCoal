// Reduced motion, lite mode and the no-WebGL fallback. Needs a preview server.
//   node scripts/check-lite.mjs [http://localhost:4173] [outDir]
import { chromium } from 'playwright'
const base = process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'http://localhost:4173'
const out = process.argv.slice(2).find((a) => !a.startsWith('http'))
const PAGES = ['/', '/map', '/cluster/talcher', '/near-me', '/how-it-works', '/limits']
const GPU = ['--enable-gpu', '--ignore-gpu-blocklist']
const only = process.env.ONLY
let failed = 0
const check = (name, ok, extra = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}
const watch = (page, errors) => {
  page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()} ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`${page.url()} ${e.message}`))
}
const clip = { x: 700, y: 120, width: 700, height: 660 } // the hero globe at 1440x900
const shot = async (p) => (await p.screenshot({ clip })).toString('base64')
const globe = (p) => p.evaluate(() => !!document.querySelector('.stage-visual.ready .globe-host canvas'))
const wake = async (p) => {
  await p.mouse.move(300, 300)
  await p.waitForFunction(() => document.querySelector('.stage-visual.ready .globe-host canvas'), null, { timeout: 15000 }).catch(() => {})
  await p.mouse.move(200, 700) // off the globe: no hover tooltip holding it still
  await p.waitForTimeout(2500)
}
const liteState = (p) =>
  p.evaluate(() => ({ pressed: document.querySelector('[data-lite-toggle]')?.getAttribute('aria-pressed'), saved: localStorage.getItem('pc-lite'), note: !!document.querySelector('.lite-note') }))

// ---- (a) normal mode (ONLY=normal|reduced|nowebgl|auto runs one block)
if (!only || only === 'normal') {
  const b = await chromium.launch({ channel: 'chrome', args: GPU })
  const errors = []
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  watch(p, errors)
  await p.goto(`${base}/?intro=0`, { waitUntil: 'networkidle' })
  await wake(p)
  check('normal: 3D globe mounted', await globe(p))
  const a = await shot(p)
  await p.waitForTimeout(1200)
  check('normal: globe animates on its own', a !== (await shot(p)))
  check('normal: logo rings rotate', (await p.evaluate(() => getComputedStyle(document.querySelector('.nav .lm-orbit')).animationName)) === 'lm-orbit')
  const s = await liteState(p)
  check('normal: lite off by default, nothing saved, no note', s.pressed === 'false' && s.saved === null && !s.note, JSON.stringify(s))
  check('normal: sound off by default', (await p.evaluate(() => document.querySelector('[data-sound-toggle]')?.getAttribute('aria-pressed'))) === 'false')
  if (out) await p.screenshot({ path: `${out}/lite-normal.png` })

  // ---- (c) lite toggle both ways, persisted
  await p.evaluate(() => document.querySelector('[data-lite-toggle]').click())
  let t = await liteState(p)
  check('lite: toggle on saves the choice', t.pressed === 'true' && t.saved === 'on' && !t.note, JSON.stringify(t))
  await p.reload({ waitUntil: 'networkidle' })
  await wake(p)
  t = await liteState(p)
  check('lite: still on after reload', t.pressed === 'true' && t.saved === 'on', JSON.stringify(t))
  check('lite: globe still mounted', await globe(p))
  if (out) await p.screenshot({ path: `${out}/lite-on.png` })
  for (const path of PAGES.slice(1)) {
    await p.goto(base + path, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1500)
    check(`lite: ${path} renders`, (await p.evaluate(() => document.querySelector('main')?.innerText.length ?? 0)) > 200)
  }
  await p.goto(`${base}/cluster/talcher`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2500)
  const feat = await p.evaluate(() => ({
    rings: !!document.querySelector('.rings-host canvas'),
    text: document.querySelector('main').innerText,
  }))
  check('lite: cluster rings canvas, brief and RTI present', feat.rings && /brief/i.test(feat.text) && /RTI/.test(feat.text), `rings ${feat.rings}`)
  await p.goto(`${base}/map`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2000)
  check('lite: risk map markers and wind trace present', await p.evaluate(() => document.querySelectorAll('.leaflet-marker-icon').length >= 11 && !!document.querySelector('.wind-panel .wind-sentence')))
  await p.evaluate(() => document.querySelector('[data-lite-toggle]').click())
  await p.goto(`${base}/?intro=0`, { waitUntil: 'networkidle' })
  await wake(p)
  t = await liteState(p)
  check('lite: toggle off persists', t.pressed === 'false' && t.saved === 'off', JSON.stringify(t))
  const c = await shot(p)
  await p.waitForTimeout(1200)
  check('lite off: full globe animates again', c !== (await shot(p)))
  check('normal + lite: no console errors', errors.length === 0, errors.slice(0, 4).join(' | '))
  await b.close()
}

// ---- (b) prefers-reduced-motion: reduce
if (!only || only === 'reduced') {
  const b = await chromium.launch({ channel: 'chrome', args: GPU })
  const errors = []
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  watch(p, errors)
  await p.goto(`${base}/`, { waitUntil: 'networkidle' })
  await wake(p)
  check('reduced: 3D globe mounted as a still', await globe(p))
  const a = await shot(p)
  await p.waitForTimeout(2000)
  check('reduced: globe does not move on its own', a === (await shot(p)))
  await p.mouse.move(1050, 450)
  await p.mouse.down()
  await p.mouse.move(900, 470, { steps: 8 })
  await p.mouse.up()
  await p.mouse.move(200, 700)
  await p.waitForTimeout(600)
  const d = await shot(p)
  check('reduced: dragging turns the globe', a !== d)
  await p.waitForTimeout(1500)
  check('reduced: still again after the drag', d === (await shot(p)))
  const css = await p.evaluate(() => ({
    orbit: getComputedStyle(document.querySelector('.nav .lm-orbit')).animationName,
    iris: getComputedStyle(document.querySelector('.nav .lm-iris')).animationName,
    cursor: !!document.querySelector('.cursor'),
    hold: !!document.querySelector('.holdfx'),
    ptx: !!document.querySelector('.ptx'),
    sound: document.querySelector('[data-sound-toggle]')?.getAttribute('aria-pressed'),
  }))
  check('reduced: logo static, no cursor ring / hold FX / transition strips, sound off', css.orbit === 'none' && css.iris === 'none' && !css.cursor && !css.hold && !css.ptx && css.sound === 'false', JSON.stringify(css))
  if (out) await p.screenshot({ path: `${out}/lite-reduced.png` })
  for (const path of PAGES.slice(1)) {
    await p.goto(base + path, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1200)
    const running = await p.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running' && (x.effect?.getTiming().iterations ?? 1) === Infinity).length)
    check(`reduced: ${path} renders with no looping animation`, running === 0 && (await p.evaluate(() => document.querySelector('main')?.innerText.length ?? 0)) > 200, `${running} looping`)
  }
  check('reduced: no console errors', errors.length === 0, errors.slice(0, 4).join(' | '))
  await b.close()
}

// ---- (d) WebGL unavailable
if (!only || only === 'nowebgl') {
  const b = await chromium.launch({ channel: 'chrome', args: ['--disable-gpu', '--disable-3d-apis'] })
  const errors = []
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  watch(p, errors)
  await p.goto(`${base}/?intro=0`, { waitUntil: 'networkidle' })
  await p.mouse.move(300, 300)
  await p.waitForTimeout(4000)
  const h = await p.evaluate(() => ({
    gl: !!document.createElement('canvas').getContext('webgl'),
    canvas: !!document.querySelector('.globe-host canvas'),
    poster: !!document.querySelector('.globe-poster.drawn canvas'),
    shown: getComputedStyle(document.querySelector('.globe-poster')).opacity,
  }))
  check('no WebGL: static globe poster instead of the canvas', !h.gl && !h.canvas && h.poster && h.shown === '1', JSON.stringify(h))
  if (out) await p.screenshot({ path: `${out}/lite-nowebgl.png` })
  for (const path of PAGES.slice(1)) {
    await p.goto(base + path, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1500)
    check(`no WebGL: ${path} renders`, (await p.evaluate(() => document.querySelector('main')?.innerText.length ?? 0)) > 200)
  }
  await p.goto(`${base}/cluster/talcher`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2000)
  check('no WebGL: cluster page shows the rings poster', await p.evaluate(() => !!document.querySelector('.ch-rings svg') && !document.querySelector('.ch-rings canvas')))
  if (out) await p.screenshot({ path: `${out}/lite-nowebgl-cluster.png` })
  check('no WebGL: no console errors', errors.length === 0, errors.slice(0, 4).join(' | '))
  await b.close()
}

// ---- auto switch: a main thread that takes 60 ms per frame keeps the globe at about 15 fps
if (!only || only === 'auto') {
  const b = await chromium.launch({ channel: 'chrome', args: GPU })
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  await p.goto(`${base}/?intro=0`, { waitUntil: 'networkidle' })
  await p.mouse.move(300, 300)
  await p.waitForFunction(() => document.querySelector('.stage-visual.ready .globe-host canvas'), null, { timeout: 15000 }).catch(() => {})
  await p.mouse.move(200, 700)
  await p.waitForTimeout(9000)
  const before = await liteState(p)
  check('auto: full mode stays on at a normal frame rate', before.pressed === 'false' && !before.note, JSON.stringify(before))
  await p.evaluate(() => {
    const burn = () => {
      const t = performance.now()
      while (performance.now() - t < 60);
      if (!window.__stopBurn) requestAnimationFrame(burn)
    }
    requestAnimationFrame(burn)
  })
  const t0 = Date.now()
  const note = await p.waitForSelector('.lite-note', { timeout: 20000 }).then(() => true, () => false)
  console.log(`      note after ${((Date.now() - t0) / 1000).toFixed(1)} s at ~15 fps`)
  await p.evaluate(() => (window.__stopBurn = true))
  const s = await liteState(p)
  check('auto: low FPS switches lite on with the note, nothing saved', note && s.pressed === 'true' && s.saved === null, JSON.stringify(s))
  if (note) {
    check('auto: note text', (await p.evaluate(() => document.querySelector('.lite-note .micro').textContent)) === 'Lite mode on for smoother performance. Switch off anytime.')
    if (out) await p.screenshot({ path: `${out}/lite-auto.png` })
    await p.click('.lite-note-x')
    check('auto: note dismisses', !(await liteState(p)).note)
    await p.evaluate(() => document.querySelector('[data-lite-toggle]').click())
    await p.reload({ waitUntil: 'networkidle' })
    const r = await liteState(p)
    check('auto: switching off is saved and overrides detection', r.pressed === 'false' && r.saved === 'off', JSON.stringify(r))
  }
  await b.close()
}

console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
