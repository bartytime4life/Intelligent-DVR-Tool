import { defineConfig } from '@playwright/test';
export default defineConfig({
  outputDir:'test-results/library', testDir:'./tests/library-browser', workers:1, retries:0, timeout:30000,
  reporter:[['list'],['json',{outputFile:'qa-local/library-browser-results.json'}]],
  use:{baseURL:'http://127.0.0.1:4198',headless:true,...(process.env.DVR_BROWSER_CHANNEL ? {channel:process.env.DVR_BROWSER_CHANNEL} : {}),viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4198 --strictPort',url:'http://127.0.0.1:4198',reuseExistingServer:false,timeout:20000},
});
