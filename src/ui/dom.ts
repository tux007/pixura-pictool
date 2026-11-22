export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text) node.textContent = text
  return node
}

// The app needs room to place a motif exactly: tablets from about 10 inch and desktops.
// Judged by the device's shorter screen side (CSS px), so orientation and browser bars do not matter:
// phones are about 390-430, iPad mini 744, iPad 810-834.
export const MIN_SCREEN_SIDE = 768

export const isSmallScreen = (width: number, height: number): boolean => Math.min(width, height) < MIN_SCREEN_SIDE

// Landscape phones: every pixel of height counts, so bars shrink and panels start folded.
export const LOW_HEIGHT = '(max-height: 560px)'

// On narrow or low screens the panels sit on top of the photo: let the user fold them away.
export function collapsible(root: HTMLElement, startFolded = false): void {
  const toggle = el('button', 'sheet-toggle', startFolded ? 'Ausklappen' : 'Einklappen')
  toggle.type = 'button'
  toggle.dataset.testid = 'sheet-toggle'
  toggle.setAttribute('aria-expanded', String(!startFolded))
  root.classList.toggle('collapsed', startFolded)
  toggle.addEventListener('click', () => {
    const folded = root.classList.toggle('collapsed')
    toggle.textContent = folded ? 'Ausklappen' : 'Einklappen'
    toggle.setAttribute('aria-expanded', String(!folded))
  })
  root.prepend(toggle)
}
