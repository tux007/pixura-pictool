import { describe, expect, it } from 'vitest'
import {
  canEnter,
  clampStep,
  firstIncomplete,
  isDone,
  nextOf,
  prevOf,
  stateOf,
  STEPS,
  type Progress,
  type StepId,
} from './steps'

const none: Progress = { hasWall: false, calibrated: false, hasMotif: false, linesSet: 0 }
const photo: Progress = { ...none, hasWall: true }
const calibrated: Progress = { ...photo, calibrated: true }
const motif: Progress = { ...calibrated, hasMotif: true }
const lines: Progress = { ...motif, linesSet: 4 }

describe('flow', () => {
  it('has the five steps in order', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['photo', 'calibrate', 'motif', 'distances', 'export'])
  })

  it('knows the neighbours', () => {
    expect(prevOf('photo')).toBeNull()
    expect(nextOf('photo')).toBe('calibrate')
    expect(prevOf('export')).toBe('distances')
    expect(nextOf('export')).toBeNull()
  })
})

describe('isDone', () => {
  it('follows the progress', () => {
    expect(isDone('photo', none)).toBe(false)
    expect(isDone('photo', photo)).toBe(true)
    expect(isDone('calibrate', photo)).toBe(false)
    expect(isDone('calibrate', calibrated)).toBe(true)
    expect(isDone('motif', calibrated)).toBe(false)
    expect(isDone('motif', motif)).toBe(true)
    expect(isDone('export', lines)).toBe(false)
  })

  it('needs all four guide lines for the distances step', () => {
    for (const n of [0, 1, 2, 3]) expect(isDone('distances', { ...motif, linesSet: n })).toBe(false)
    expect(isDone('distances', { ...motif, linesSet: 4 })).toBe(true)
  })
})

describe('canEnter', () => {
  it('always allows the first step', () => {
    expect(canEnter('photo', none)).toEqual({ ok: true, reason: null })
  })

  it('unlocks each step only after the ones before it', () => {
    expect(canEnter('calibrate', none).ok).toBe(false)
    expect(canEnter('calibrate', photo).ok).toBe(true)
    expect(canEnter('motif', photo).ok).toBe(false)
    expect(canEnter('motif', calibrated).ok).toBe(true)
    expect(canEnter('distances', calibrated).ok).toBe(false)
    expect(canEnter('distances', motif).ok).toBe(true)
    expect(canEnter('export', motif).ok).toBe(false)
    expect(canEnter('export', lines).ok).toBe(true)
  })

  it('names what is missing', () => {
    expect(canEnter('calibrate', none).reason).toContain('Foto')
    expect(canEnter('motif', photo).reason).toContain('Massstab')
    expect(canEnter('distances', calibrated).reason).toContain('Motiv')
    expect(canEnter('export', motif).reason).toContain('vier Linien')
  })

  it('reports the first gap when several are missing', () => {
    expect(canEnter('export', none).reason).toContain('Foto')
    expect(canEnter('export', photo).reason).toContain('Massstab')
  })

  it('does not accept three of four lines', () => {
    expect(canEnter('export', { ...motif, linesSet: 3 }).ok).toBe(false)
  })
})

describe('firstIncomplete', () => {
  it('points at the next thing to do', () => {
    expect(firstIncomplete(none)).toBe('photo')
    expect(firstIncomplete(photo)).toBe('calibrate')
    expect(firstIncomplete(calibrated)).toBe('motif')
    expect(firstIncomplete(motif)).toBe('distances')
    expect(firstIncomplete(lines)).toBe('export')
  })
})

describe('clampStep', () => {
  it('keeps steps that can be opened', () => {
    expect(clampStep('motif', calibrated)).toBe('motif')
    expect(clampStep('export', lines)).toBe('export')
  })

  it('steps back when a prerequisite disappears', () => {
    // motif removed while on the export step
    expect(clampStep('export', { ...calibrated, linesSet: 4 })).toBe('motif')
    // calibration reset
    expect(clampStep('distances', photo)).toBe('calibrate')
    expect(clampStep('export', none)).toBe('photo')
  })
})

describe('stateOf', () => {
  const states = (current: StepId, p: Progress): string[] => STEPS.map((s) => stateOf(s.id, current, p))

  it('marks finished, open and locked steps', () => {
    expect(states('motif', calibrated)).toEqual(['done', 'done', 'current', 'locked', 'locked'])
    expect(states('photo', lines)).toEqual(['current', 'done', 'done', 'done', 'todo'])
    expect(states('photo', none)).toEqual(['current', 'locked', 'locked', 'locked', 'locked'])
  })

  it('shows the next unfinished step as open', () => {
    expect(states('calibrate', photo)).toEqual(['done', 'current', 'locked', 'locked', 'locked'])
    expect(states('photo', photo)).toEqual(['current', 'todo', 'locked', 'locked', 'locked'])
  })
})
