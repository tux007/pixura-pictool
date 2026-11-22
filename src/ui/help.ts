import { el } from './dom'

const TIPS: [string, string][] = [
  ['Frontal fotografieren.', 'Stell dich gerade vor die Wand, nicht von der Seite. Das Handy oder Tablet möglichst parallel zur Wand halten.'],
  ['Die ganze Wand ins Bild nehmen.', 'Boden, Decke und beide Wandkanten sollten sichtbar sein, wenn du dort Abstände messen willst.'],
  ['Nicht im Ultraweitwinkel-Modus.', 'Die normale Kamera (1×) verwenden. Der Ultraweitwinkel verzerrt zum Rand hin, das Tool korrigiert das nicht.'],
  ['Eine Referenz sichtbar lassen.', 'Massband, Türrahmen oder zwei Malerkrepp-Markierungen mit bekanntem Abstand. Je grösser die Referenz, desto genauer, am besten mindestens ca. 1 m.'],
  ['Bei schrägem Foto ein Rechteck verwenden.', 'Tür, Fenster oder eine markierte Fläche mit bekannter Breite und Höhe: dann den Modus „Rechteck (4 Punkte)“ wählen.'],
  ['Foto nicht zuschneiden.', 'Ein unbeschnittenes Foto macht die Perspektive-Prüfung zuverlässiger.'],
]

export function openHelp(): void {
  const dialog = el('dialog', 'help')
  dialog.setAttribute('aria-labelledby', 'help-title')
  dialog.dataset.testid = 'help-dialog'

  const title = el('h2', undefined, 'So fotografierst du die Wand')
  title.id = 'help-title'
  const list = el('ol', 'tips')
  for (const [head, body] of TIPS) {
    const li = el('li')
    li.append(el('strong', undefined, head), document.createTextNode(` ${body}`))
    list.append(li)
  }
  const flow = el(
    'p',
    undefined,
    'Die App führt dich in fünf Schritten: Foto, Kalibrieren, Motiv, Abstände, Export. Oben siehst du, wo du bist. Unten geht es mit „Weiter“ voran, mit „Zurück“ kannst du jederzeit einen Schritt korrigieren. Die Vorschau ist eine Näherung (Massangaben ca. ± wenige cm).',
  )
  const devices = el(
    'p',
    undefined,
    'Geeignete Geräte: Tablets ab ca. 10 Zoll und Desktop. Auf Handys und kleinen Tablets (z. B. iPad mini) ist die Fläche zu klein, um ein Motiv genau zu platzieren.',
  )
  const close = el('button', 'btn primary', 'Schliessen')
  close.type = 'button'
  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => dialog.remove())
  dialog.append(title, list, flow, devices, close)
  document.body.append(dialog)
  dialog.showModal()
}
