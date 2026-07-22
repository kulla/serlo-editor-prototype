import { defineConfig } from '@playwright/test'

export default defineConfig({
  webServer: {
    command: 'bun dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
