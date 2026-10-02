// End-to-end: drive the real page in Chrome. Needs `npm run serve` running.
// node tests/e2e.mjs [url]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:8642/';
const out = new URL('./out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

let failed = 0;
const step = async (name, fn) => {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
};
const printsOk = async (what) => {
  await page.waitForFunction(() => document.querySelector('#status').dataset.kind === 'busy' || document.querySelector('#status').dataset.kind === 'ok', null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#status').dataset.kind === 'ok', null, { timeout: 90000 });
  const text = await page.textContent('#status');
  if (!/4 free parts/.test(text)) throw new Error(`${what}: status "${text}"`);
};
const download = async (sel, name) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
  await dl.saveAs(out + name);
  return dl.suggestedFilename();
};

await step('page loads and the Orbital example prints in place', async () => {
  await page.goto(url);
  await printsOk('orbital');
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + 'e2e-orbital.png' });
});

await step('Orbital 3MF and STL zip download', async () => {
  const a = await download('#dl3mf', 'e2e-orbital.3mf');
  const b = await download('#dlstl', 'e2e-orbital-stl.zip');
  if (!a.endsWith('.3mf') || !b.endsWith('.zip')) throw new Error(`${a} / ${b}`);
});

await step('top view renders the artwork', async () => {
  await page.click('#top');
  await page.waitForTimeout(500);
  await page.locator('#preview').screenshot({ path: out + 'e2e-orbital-top.png' });
});

await step('blank preset builds', async () => {
  await page.click('[data-preset=startup]');
  await printsOk('blank');
});

await step('PNG logo upload, custom text, loose fit', async () => {
  await page.setInputFiles('#coreDrop input[type=file]', new URL('./fixtures/logo.png', import.meta.url).pathname);
  await page.waitForFunction(() => document.querySelector('#coreName').textContent === 'logo.png', null, { timeout: 30000 });
  await page.fill('#ringText', 'ACME ROCKETS');
  await page.fill('#bottom', 'ACME.EXAMPLE');
  await page.click('label:has(input[name=fit][value=loose])');
  await printsOk('custom');
  await page.check('#spin');
  await page.waitForTimeout(900);
  await page.screenshot({ path: out + 'e2e-custom.png' });
  const name = await download('#dl3mf', 'e2e-custom.3mf');
  if (name !== 'acme-rockets-gyro.3mf') throw new Error(`file name ${name}`);
});

await step('SVG wordmark round the ring', async () => {
  await page.setInputFiles('#ringDrop input[type=file]', new URL('../examples/orbital/wordmark.svg', import.meta.url).pathname);
  await printsOk('wordmark');
});

await step('phone width: no sideways scroll', async () => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.waitForTimeout(400);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: out + 'e2e-phone.png', fullPage: false });
  if (over > 0) throw new Error(`page is ${over}px wider than the screen`);
});

await step('no console errors', async () => {
  if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
});

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
