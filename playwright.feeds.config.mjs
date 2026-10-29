import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/feeds-browser', workers:1, retries:0, timeout:30000,
  reporter:[['list'],['json',{outputFile:'qa-local/feeds-browser-results.json'}]],
  use:{baseURL:'http://127.0.0.1:4184', headless:true, channel:'chromium', viewport:{width:1440,height:1000},
    permissions:['camera'], launchOptions:{args:['--use-fake-device-for-media-stream']},
    screenshot:'only-on-failure', trace:'retain-on-failure'},
  webServer:{command:`python -c "import runpy; runpy.run_path('tests/local_feeds_fixture.py', run_name='__main__')"`,url:'http://127.0.0.1:4184',reuseExistingServer:false,timeout:20000},
});
