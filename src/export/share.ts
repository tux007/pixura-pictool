export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled'

export function canShareFiles(): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] })
  } catch {
    return false
  }
}

export function download(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// Native share sheet with the file attached; falls back to a plain download.
export async function shareFile(file: File, title: string): Promise<ShareOutcome> {
  try {
    if (!navigator.canShare?.({ files: [file] })) throw new Error('cannot share files')
    await navigator.share({ files: [file], title })
    return 'shared'
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    download(file)
    return 'downloaded'
  }
}
