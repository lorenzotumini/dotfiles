import { chromium } from 'playwright-core';

// A fresh unauthenticated context for each read: never touches the debug profile.
export async function renderPage(url, signal, timeoutMs = 20000) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Rendering requires HTTP(S)');
  const deadline = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  deadline.throwIfAborted();
  let browser;
  const launching = chromium.launch({ headless: true, timeout: timeoutMs });
  const stop = () => { void launching.then(b => b.close()).catch(() => {}); };
  let abort;
  const aborted = new Promise((_, reject) => {
    abort = () => { stop(); reject(new Error('Browser rendering cancelled or timed out')); };
    deadline.addEventListener('abort', abort, { once: true });
    if (deadline.aborted) abort();
  });
  try {
    return await Promise.race([aborted, (async () => {
      browser = await launching;
      deadline.throwIfAborted();
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      // No images/media/fonts are needed for text extraction. Scripts/XHR remain enabled.
      await context.route('**/*', route => ['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue());
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      if (response && !response.ok()) throw new Error(`Rendered HTTP ${response.status()}`);
      // Bounded settling for SPAs; networkidle would hang on polling sites.
      await page.waitForTimeout(1000);
      const html = await page.evaluate(() => {
        const source = document.documentElement.outerHTML;
        if (source.length > 5 * 1024 * 1024) throw new Error('Rendered DOM too large');
        return source;
      });
      if (Buffer.byteLength(html) > 5 * 1024 * 1024) throw new Error('Rendered DOM too large');
      return { html, url: page.url() };
    })()]);
  } finally {
    deadline.removeEventListener('abort', abort);
    await (browser ? browser.close() : launching.then(b => b.close())).catch(() => {});
  }
}
