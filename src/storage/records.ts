import type { GuideKind, Guides } from '../math/guides'
import { GUIDE_KINDS } from '../math/guides'
import type { Box } from '../math/motif'
import type { Calibration, Project } from '../model/types'

export const RECORD_VERSION = 1

export interface StoredImage {
  blob: Blob
  name: string
  type: string
}

export interface StoredVariant extends StoredImage {
  box: Box
  aspect: number
  opacity: number
  lockAspect: boolean
}

// What goes into IndexedDB. Images are the user's original files, decoded again on open.
export interface StoredProject {
  version: typeof RECORD_VERSION
  id: string
  name: string
  updated: number
  wall: StoredImage
  calibration: Calibration | null
  variants: StoredVariant[]
  active: number
  guides: Guides
  showDims: boolean
  toleranceCm: number
  thumb: Blob | null
}

export interface ProjectSummary {
  id: string
  name: string
  updated: number
  thumb: Blob | null
  variants: number
  calibrated: boolean
}

const pad = (n: number): string => String(n).padStart(2, '0')

// RFC 4122 v4 id; crypto.randomUUID() is missing on plain-http pages (e.g. a tablet on the LAN).
export function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function formatStamp(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const defaultName = (ms: number): string => `Projekt ${formatStamp(ms).replace(',', '')}`

const image = (f: File): StoredImage => ({ blob: f, name: f.name, type: f.type })

export function toRecord(p: Project, thumb: Blob | null): StoredProject {
  if (!p.wall) throw new Error('project has no wall')
  return {
    version: RECORD_VERSION,
    id: p.id,
    name: p.name,
    updated: p.updated,
    wall: image(p.wall.source),
    calibration: p.wall.calibration,
    variants: p.variants.map((m) => ({
      ...image(m.source),
      box: { ...m.box },
      aspect: m.aspect,
      opacity: m.opacity,
      lockAspect: m.lockAspect,
    })),
    active: p.active,
    guides: { ...p.guides },
    showDims: p.showDims,
    toleranceCm: p.toleranceCm,
    thumb,
  }
}

export const toFile = (s: StoredImage): File => new File([s.blob], s.name, { type: s.type })

export function summary(r: StoredProject): ProjectSummary {
  return {
    id: r.id,
    name: r.name,
    updated: r.updated,
    thumb: r.thumb,
    variants: r.variants.length,
    calibrated: r.calibration !== null,
  }
}

// --- validation: stored data is untrusted (older versions, manual edits, partial writes) ---

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isPt = (x: unknown): boolean => isObj(x) && num(x.x) && num(x.y)
const isMat = (x: unknown): boolean => Array.isArray(x) && x.length === 9 && x.every(num)
const isStoredImage = (x: unknown): x is StoredImage =>
  isObj(x) && x.blob instanceof Blob && typeof x.name === 'string' && typeof x.type === 'string'

const isBox = (x: unknown): x is Box =>
  isObj(x) && num(x.x) && num(x.y) && num(x.w) && num(x.h) && num(x.rot) && x.w > 0 && x.h > 0

function isCalibration(x: unknown): x is Calibration {
  if (!isObj(x)) return false
  if (x.mode === 'linear') return num(x.pxPerCm) && x.pxPerCm > 0
  if (x.mode === 'perspective') {
    return (
      isMat(x.h) &&
      isMat(x.hInv) &&
      num(x.widthCm) &&
      num(x.heightCm) &&
      Array.isArray(x.quad) &&
      x.quad.length === 4 &&
      x.quad.every(isPt) &&
      isObj(x.quality)
    )
  }
  return false
}

function isGuides(x: unknown): x is Guides {
  if (!isObj(x)) return false
  return Object.entries(x).every(([k, v]) => GUIDE_KINDS.includes(k as GuideKind) && num(v))
}

function isVariant(x: unknown): x is StoredVariant {
  return (
    isStoredImage(x) &&
    isBox((x as unknown as Record<string, unknown>).box) &&
    num((x as unknown as Record<string, unknown>).aspect) &&
    num((x as unknown as Record<string, unknown>).opacity) &&
    typeof (x as unknown as Record<string, unknown>).lockAspect === 'boolean'
  )
}

export function validateRecord(x: unknown): StoredProject | null {
  if (!isObj(x) || x.version !== RECORD_VERSION) return null
  if (typeof x.id !== 'string' || !x.id || typeof x.name !== 'string' || !num(x.updated)) return null
  if (!isStoredImage(x.wall)) return null
  if (x.calibration !== null && !isCalibration(x.calibration)) return null
  if (!Array.isArray(x.variants) || x.variants.length > 3 || !x.variants.every(isVariant)) return null
  if (!Number.isInteger(x.active) || (x.active as number) < 0) return null
  if (x.variants.length > 0 && (x.active as number) >= x.variants.length) return null
  if (!isGuides(x.guides) || typeof x.showDims !== 'boolean' || !num(x.toleranceCm)) return null
  if (x.thumb !== null && !(x.thumb instanceof Blob)) return null
  return x as unknown as StoredProject
}
