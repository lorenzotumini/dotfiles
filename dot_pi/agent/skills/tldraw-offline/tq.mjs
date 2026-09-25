#!/usr/bin/env node
// <!-- installed-by:tldraw-desktop-agent-skills -->
// tq — tldraw agent-api helper. Usage:
//   node tq.mjs GET  /api/doc/DOC/script-status
//   node tq.mjs POST /api/search '{"code":"return await api.getDocs()"}'             # JSON body
//   node tq.mjs POST /api/doc/DOC/exec 'return editor.getCurrentPageShapes().length' # raw JS body
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
const serverJsonPath = process.env.APPDATA
	? path.join(process.env.APPDATA, 'tldraw', 'server.json')
	: path.join(configDir, 'tldraw', 'server.json')

function readServerJson() {
	try {
		return JSON.parse(fs.readFileSync(serverJsonPath, 'utf8'))
	} catch {
		return null
	}
}

const [method, requestPath, body] = process.argv.slice(2)
const server = readServerJson()
if (!server?.port || !server?.token) {
	console.error(`tq: cannot read ${serverJsonPath} — the tldraw desktop app is not running`)
	process.exit(1)
}

const headers = { authorization: `Bearer ${server.token}` }
if (body) headers['content-type'] = body.startsWith('{') ? 'application/json' : 'text/plain'

// 127.0.0.1 rather than localhost, which resolves to ::1 first on Windows while
// the server binds IPv4 only.
const req = http.request(
	{ host: '127.0.0.1', port: server.port, path: requestPath, method, headers },
	(res) => res.pipe(process.stdout)
)
req.on('error', (err) => {
	console.error(`tq: ${err.message}`)
	process.exitCode = 1
})
req.end(body || undefined)
