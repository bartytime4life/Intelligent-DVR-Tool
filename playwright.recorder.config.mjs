import { defineConfig } from '@playwright/test';
export default defineConfig({
  outputDir:'test-results/recorder', testDir:'./tests/recorder-browser', workers:1, retries:0, timeout:60000,
  reporter:[['list'], ['json',{outputFile:'qa-local/recorder-browser-results.json'}]],
  use:{baseURL:'http://127.0.0.1:4186',headless:true,viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:{command:'python tests/lan_recorder_fixture.py',url:'http://127.0.0.1:4186',reuseExistingServer:false,timeout:20000},
});
