import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  // tall enough that the stage keeps its size next to the step bar, instructions and footer
  use: { baseURL: 'http://localhost:4174', viewport: { width: 1280, height: 900 } },
  webServer: {
    command: 'npm run build && vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
