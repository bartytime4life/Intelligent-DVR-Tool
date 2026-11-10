import { test, expect } from '@playwright/test';

for (const workspace of ['Settings', 'System']) {
  test(`direct ${workspace} loads Monitor only when chosen and starts no capture`, async ({ page }) => {
    const modules = new Set(), serviceRequests = [], errors = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/src/')) modules.add(url.pathname);
      if (url.pathname.startsWith('/api/')) serviceRequests.push({ method: request.method(), path: url.pathname });
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.generatedCaptureStarts = { webcam: 0, recorder: 0 };
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
        enumerateDevices: async () => [],
        getUserMedia: async () => {
          window.generatedCaptureStarts.webcam++;
          throw new DOMException('Unexpected webcam start in an offline navigation test', 'NotAllowedError');
        },
      } });
      window.MediaRecorder = class {
        static isTypeSupported() { return true; }
        constructor() {
          window.generatedCaptureStarts.recorder++;
          throw new Error('Unexpected recording start in an offline navigation test');
        }
      };
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      // No real local camera, recorder or inference service is contacted.
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { live: { enabled: false } } });
      return route.continue();
    });
    await page.goto(`/#${workspace.toLowerCase()}`);
    await expect(page.getByRole('heading', { name: workspace === 'Settings' ? 'Connections and local evidence' : 'Give every camera room to work.', exact: true })).toBeVisible();
    expect(modules.has('/src/LiveMonitor.jsx')).toBe(false);
    expect(modules.has('/src/recognition-report.mjs')).toBe(false);
    expect(serviceRequests).toEqual([]);

    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Monitor', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect source', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record webcam clip', exact: true })).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Monitor 0 receiving', exact: true })).toBeVisible();
    await expect.poll(() => serviceRequests.some(request => request.method === 'GET' && request.path === '/api/analysis/session')).toBe(true);
    expect(modules.has('/src/LiveMonitor.jsx')).toBe(true);
    expect(modules.has('/src/recognition-report.mjs')).toBe(false);
    expect(serviceRequests.filter(request => request.method !== 'GET')).toEqual([]);
    expect(await page.evaluate(() => window.generatedCaptureStarts)).toEqual({ webcam: 0, recorder: 0 });
    expect(errors).toEqual([]);
  });
}
