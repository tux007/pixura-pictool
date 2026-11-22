import './styles.css'
import { mountApp } from './ui/app'

const root = document.getElementById('app')
if (!root) throw new Error('#app missing')
mountApp(root)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
