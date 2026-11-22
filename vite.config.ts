import { createHash } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? listFiles(full, root) : [relative(root, full)]
  })
}

// Injects the precache list and a content version into the service worker chunk.
function precache(): Plugin {
  return {
    name: 'pixura-precache',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const sw = bundle['sw.js']
      if (!sw || sw.type !== 'chunk') throw new Error('sw.js entry missing from bundle')
      const built = Object.keys(bundle).filter((f) => f !== 'sw.js')
      const files = ['/', ...built.map((f) => '/' + f), ...listFiles('public').map((f) => '/' + f)]
      const html = bundle['index.html']
      const hash = createHash('sha256')
        .update(files.join('\n'))
        .update(html && html.type === 'asset' ? String(html.source) : '')
        .digest('hex')
        .slice(0, 12)
      const list = /(["'`])__PRECACHE__\1/
      if (!list.test(sw.code)) throw new Error('precache placeholder not found in sw.js')
      sw.code = sw.code
        .replace(list, () => JSON.stringify(JSON.stringify(files)))
        .replace(/__VERSION__/g, hash)
    },
  }
}

export default defineConfig({
  plugins: [precache()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { main: 'index.html', sw: 'src/sw/sw.ts' },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
})
