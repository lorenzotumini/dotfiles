import { parentPort, workerData } from 'node:worker_threads';
import { extractHTML, extractPDF } from './extract.mjs';
try {
  const { kind, body, url, pages } = workerData;
  const result = kind === 'pdf' ? await extractPDF(body, url, pages) : extractHTML(body, url);
  parentPort.postMessage({ result });
} catch (error) { parentPort.postMessage({ error: error.message }); }
