import { useSyncExternalStore } from 'react'

// Lite mode: the same site with lighter visuals (lower DPR, no particles or halo, no auto-rotation).
// Off by default. It turns on by itself only when the globe's measured frame rate stays low (see
// three/GlobeCanvas), and a manual choice (the footer switch, saved in localStorage 'pc-lite')
// always wins over that measurement.
const KEY = 'pc-lite'

type Listener = () => void

function stored(): 'on' | 'off' | null {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'on' || v === 'off') return v
  } catch {
    /* storage blocked */
  }
  return null
}

const saved = stored()
let on = saved === 'on'
let chosen = saved !== null
let note = false
const subs = new Set<Listener>()
const emit = () => subs.forEach((fn) => fn())

export const lite = {
  get on() {
    return on
  },
  /** True once the user has picked a side (now or on an earlier visit): no auto-switching then. */
  get chosen() {
    return chosen
  },
  /** Manual switch: saved, and it overrides auto-detection from now on. */
  set(v: boolean) {
    try {
      localStorage.setItem(KEY, v ? 'on' : 'off')
    } catch {
      /* storage blocked */
    }
    on = v
    chosen = true
    note = false
    emit()
  },
  /** Auto-detection (low measured FPS): lite on for this visit, with the note. Not saved. */
  auto() {
    if (chosen || on) return
    on = true
    note = true
    emit()
  },
  dismissNote() {
    if (!note) return
    note = false
    emit()
  },
  subscribe(fn: Listener) {
    subs.add(fn)
    return () => {
      subs.delete(fn)
    }
  },
}

export const useLite = () =>
  useSyncExternalStore(
    lite.subscribe,
    () => on,
    () => false,
  )

/** The "Lite mode on…" note is showing (after an automatic switch, until dismissed). */
export const useLiteNote = () =>
  useSyncExternalStore(
    lite.subscribe,
    () => note,
    () => false,
  )
