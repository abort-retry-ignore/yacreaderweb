const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3200',
    headless: true,
    serviceWorkers: 'block',
  },
  webServer: [
    {
      command: 'node tests/mock-yacr-server.js',
      port: 6100,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'WEBREADER_PORT=3200 YACR_SERVER_URL=http://127.0.0.1:6100 node src/server.js',
      port: 3200,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
