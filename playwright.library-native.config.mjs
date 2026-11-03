import {defineConfig} from '@playwright/test';
export default defineConfig({
  outputDir:'test-results/library-native',testDir:'./tests/library-native-browser',workers:1,retries:0,timeout:60000,
  reporter:[['list'],['json',{outputFile:'qa-local/library-native-browser-results.json'}]],
  use:{baseURL:'http://127.0.0.1:4199',headless:true,...(process.env.DVR_BROWSER_CHANNEL ? {channel:process.env.DVR_BROWSER_CHANNEL} : {}),viewport:{width:1440,height:1100},screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:{command:`${process.env.DVR_TEST_PYTHON || 'python3'} tests/library_native_fixture.py`,url:'http://127.0.0.1:4199',reuseExistingServer:false,timeout:30000},
});
