// The guided flow: five steps, each unlocked by finishing the ones before it.
// Pure logic, so the rules can be tested without a browser.

export type StepId = 'photo' | 'calibrate' | 'motif' | 'distances' | 'export'

export interface Step {
  id: StepId
  label: string
  title: string
}

export const STEPS: readonly Step[] = [
  { id: 'photo', label: 'Foto', title: 'Foto der Wand' },
  { id: 'calibrate', label: 'Kalibrieren', title: 'Massstab festlegen' },
  { id: 'motif', label: 'Motiv', title: 'Motiv platzieren' },
  { id: 'distances', label: 'Abstände', title: 'Wandabstände prüfen' },
  { id: 'export', label: 'Export', title: 'Ergebnis exportieren' },
]

// Ceiling, floor and both inner corners: all four are needed to check the wallPen distances.
export const LINES_NEEDED = 4

export interface Progress {
  hasWall: boolean
  calibrated: boolean
  hasMotif: boolean
  linesSet: number
}

const DONE: Record<StepId, (p: Progress) => boolean> = {
  photo: (p) => p.hasWall,
  calibrate: (p) => p.calibrated,
  motif: (p) => p.hasMotif,
  distances: (p) => p.linesSet >= LINES_NEEDED,
  export: () => false,
}

// Shown when the step after this one cannot be opened yet.
const MISSING: Record<StepId, string> = {
  photo: 'Erst ein Foto laden.',
  calibrate: 'Erst den Massstab festlegen (Kalibrieren).',
  motif: 'Erst ein Motiv laden.',
  distances: 'Erst alle vier Linien setzen (Decke, Boden, linke und rechte Innenecke).',
  export: '',
}

export const indexOfStep = (id: StepId): number => STEPS.findIndex((s) => s.id === id)

export const stepOf = (id: StepId): Step => STEPS[indexOfStep(id)] ?? (STEPS[0] as Step)

export const isDone = (id: StepId, p: Progress): boolean => DONE[id](p)

export function canEnter(id: StepId, p: Progress): { ok: boolean; reason: string | null } {
  for (const s of STEPS.slice(0, indexOfStep(id))) {
    if (!isDone(s.id, p)) return { ok: false, reason: MISSING[s.id] }
  }
  return { ok: true, reason: null }
}

export const nextOf = (id: StepId): StepId | null => STEPS[indexOfStep(id) + 1]?.id ?? null

export const prevOf = (id: StepId): StepId | null => STEPS[indexOfStep(id) - 1]?.id ?? null

// Where to continue: the first step that is not finished yet, or the export once everything is.
export function firstIncomplete(p: Progress): StepId {
  return STEPS.find((s) => s.id !== 'export' && !isDone(s.id, p))?.id ?? 'export'
}

// Steps back until the step can be opened, e.g. after the motif was removed while on the export step.
export function clampStep(id: StepId, p: Progress): StepId {
  let cur = id
  while (!canEnter(cur, p).ok) {
    const prev = prevOf(cur)
    if (!prev) break
    cur = prev
  }
  return cur
}

export type StepState = 'current' | 'done' | 'todo' | 'locked'

export function stateOf(id: StepId, current: StepId, p: Progress): StepState {
  if (id === current) return 'current'
  if (!canEnter(id, p).ok) return 'locked'
  return isDone(id, p) ? 'done' : 'todo'
}
