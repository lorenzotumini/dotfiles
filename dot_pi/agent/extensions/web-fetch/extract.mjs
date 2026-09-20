import { extractRSCContent } from './rsc.mjs';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

export function extractHTML(html, url) {
  const { document } = parseHTML(html);
  let base = url;
  try { base = new URL(document.querySelector('base[href]')?.getAttribute('href') || url, url).href; } catch {}
  for (const el of document.querySelectorAll('[href], [src]')) {
    for (const attr of ['href', 'src']) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      try {
        const resolved = new URL(value, base);
        if (['http:', 'https:', 'mailto:'].includes(resolved.protocol)) el.setAttribute(attr, resolved.href);
        else el.removeAttribute(attr);
      } catch { el.removeAttribute(attr); }
    }
  }
  const title = document.querySelector('title')?.textContent?.trim() || '';
  const visible = document.cloneNode(true);
  for (const el of visible.querySelectorAll('script,style,noscript,template')) el.remove();
  const plain = (visible.body?.textContent || '').replace(/\s+/g, ' ').trim();
  const challenge = /^(just a moment|attention required|access denied|verify (you|your)|security check)/i.test(title) ||
    /^(verify (you are|that you are)|checking your browser|please complete the security check)/i.test(plain) ||
    (!!document.querySelector('#challenge-form, #cf-challenge-running, .g-recaptcha') && plain.length < 1500);
  const login = !!document.querySelector('input[type="password"]') &&
    (/sign in|log in|login/i.test(title) || plain.length < 1000);
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  td.addRule('tables', {
    filter: 'table', replacement(_content, node) {
      // Complex tables retain HTML structure: Markdown cannot represent spans reliably.
      if (node.querySelector('[rowspan], [colspan], table')) return '\n\n' + node.outerHTML + '\n\n';
      const rows = Array.from(node.querySelectorAll('tr')).map(row => Array.from(row.children)
        .filter(cell => /^(TH|TD)$/.test(cell.tagName))
        .map(cell => td.turndown(cell.innerHTML).replace(/\|/g, '\\|').replace(/\n+/g, '<br>')));
      if (!rows.length) return '';
      const width = Math.max(...rows.map(row => row.length));
      const line = row => '| ' + Array.from({ length: width }, (_, i) => row[i] || '').join(' | ') + ' |';
      if (!node.querySelector('tr th')) rows.unshift(Array(width).fill(''));
      return '\n\n' + [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n') + '\n\n';
    },
  });
  const article = new Readability(document.cloneNode(true)).parse();
  for (const el of visible.querySelectorAll('nav,footer,aside')) el.remove();
  const fallback = visible.querySelector('main,article') || visible.body;
  let content = td.turndown(article?.content || fallback?.innerHTML || '').trim();
  let extraction = article ? 'readability' : 'dom';
  if (!challenge && !login && content.length < 100) {
    const rsc = extractRSCContent(html, url);
    if (rsc && rsc.content.length > content.length) { content = rsc.content; extraction = 'rsc'; }
  }
  const jsShell = extraction !== 'rsc' && document.querySelectorAll('script').length > 0 &&
    (!plain || /^(loading[.\s…]*|please enable javascript[.\s]*)$/i.test(plain));
  const warning = challenge ? 'Suspected verification/challenge page; source content was not retrieved.' :
    login ? 'Suspected login page; source content may require authentication.' :
    jsShell ? 'Page appears JavaScript-rendered. Try mode="render".' :
    !content ? 'No readable content. Try mode="raw" or mode="render".' : null;
  return { url, title, content, error: warning, details: { extraction, blocked: challenge || login } };
}

export async function extractPDF(bytes, url, spec) {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const selected = new Set();
    if (spec) {
      for (const part of spec.split(',')) {
        const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
        const start = Number(m?.[1]), end = Number(m?.[2] || start);
        if (!m || start < 1 || end < start || end > pdf.numPages || end - start >= 100) throw new Error('Invalid PDF pages; use physical ranges within the document, at most 100 pages.');
        for (let i = start; i <= end; i++) selected.add(i);
      }
    } else for (let i = 1; i <= Math.min(20, pdf.numPages); i++) selected.add(i);
    if (selected.size > 100) throw new Error('Select at most 100 PDF pages per call.');
    const pages = [...selected].sort((a,b) => a-b);
    const labels = await pdf.getPageLabels();
    const empty = [];
    const output = [];
    for (const i of pages) {
      const page = await pdf.getPage(i);
      const text = await page.getTextContent();
      const body = text.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('').trim();
      if (!body) empty.push(i);
      output.push(`--- Physical page ${i}${labels?.[i-1] ? ` (label: ${labels[i-1]})` : ''} ---\n${body || '[No extractable text: blank, scanned, or unsupported encoding. Use pdf-reader rendering/OCR.]'}`);
      page.cleanup();
    }
    const meta = await pdf.getMetadata().catch(() => ({}));
    return { url, title: meta.info?.Title || 'PDF document', error: null,
      content: `Pages: ${pdf.numPages}; extracted physical pages: ${pages.join(', ')}.\nText order/layout may need visual checking.\n\n${output.join('\n\n')}`,
      details: { pageCount: pdf.numPages, extractedPages: pages, emptyTextPages: empty, sourceTruncated: pages.length < pdf.numPages } };
  } finally { await pdf.destroy(); }
}
