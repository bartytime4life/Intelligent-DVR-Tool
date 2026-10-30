import { defineConfig } from '@playwright/test';
export default defineConfig({
  outputDir: 'test-results/analysis',
  testDir: './tests/analysis-browser', fullyParallel: false, workers: 1, retries: 0, timeout: 30000,
  reporter: [['list'], ['json', {outputFile:'qa-local/analysis-browser-results.json'}]],
  use: {baseURL:'http://127.0.0.1:4183',headless:true,channel:'chromium',permissions:['camera'],launchOptions:{args:['--use-fake-device-for-media-stream']},viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer: {
    command: 'python tests/local_analysis_fixture.py --output qa-local/analysis-browser && python -m edge.local_service --recordings qa-local/analysis-browser/recordings --config qa-local/analysis-browser/config.json --allow-recording-import --port 4183',
    url:'http://127.0.0.1:4183',reuseExistingServer:false,timeout:20000,
  },
});
