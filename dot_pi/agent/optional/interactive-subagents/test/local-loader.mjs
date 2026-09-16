// Use the installed Pi runtime and its compatibility aliases; no npm install.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const piDir = process.env.PI_CODING_AGENT_PACKAGE ?? resolve(dirname(process.execPath), '../lib/node_modules/@earendil-works/pi-coding-agent');
const require = createRequire(join(piDir, 'package.json'));
const { createJiti } = require('jiti');
export const jiti = createJiti(import.meta.url, { interopDefault: false, moduleCache: false, fsCache: false, alias: {
  '@mariozechner/pi-coding-agent': join(piDir, 'dist/index.js'),
  '@mariozechner/pi-tui': require.resolve('@earendil-works/pi-tui'),
  '@sinclair/typebox': require.resolve('typebox'),
} });
export const { loadExtensions } = await import(pathToFileURL(join(piDir, 'dist/core/extensions/loader.js')));
