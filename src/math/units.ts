export type Unit = 'cm' | 'm'

const LENGTH = /^\s*(\d+(?:[.,]\d*)?|[.,]\d+)\s*(cm|m)?\s*$/i

// Parses "250", "2,5 m", "2.5m", "80 cm" into centimetres. Returns null for anything else.
export function parseLength(text: string, fallback: Unit = 'cm'): number | null {
  const m = LENGTH.exec(text)
  if (!m) return null
  const value = Number((m[1] ?? '').replace(',', '.'))
  if (!Number.isFinite(value)) return null
  const unit = (m[2] ?? fallback).toLowerCase()
  return unit === 'm' ? value * 100 : value
}

export function formatNumber(v: number, digits = 1): string {
  const f = 10 ** digits
  const r = Math.round(v * f) / f
  return (Object.is(r, -0) ? 0 : r).toFixed(digits).replace('.', ',')
}

export function formatLength(cm: number): string {
  return Math.abs(cm) >= 100 ? `${formatNumber(cm / 100, 2)} m` : `${formatNumber(cm)} cm`
}
