import assert from 'node:assert/strict';
import { search, buildQuery, MAX_RESPONSE_BYTES, ENDPOINT } from '../exa.mjs';
let checks = 0;
const packet = text => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
async function run(response, args = { query: 'fixture' }) {
  const result = await search(args, undefined, async (url, options) => {
    assert.equal(url, ENDPOINT);
    assert.ok(!Object.keys(options.headers).some(k => /authorization|key/i.test(k)));
    const body = JSON.parse(options.body);
    assert.equal(body.params.name, 'web_search_exa');
    assert.equal(body.params.arguments.numResults, args.count ?? 5);
    return response;
  });
  assert.ok(Buffer.byteLength(result.content[0].text) <= 16384);
  assert.ok(result.content[0].text.split('\n').length <= 400);
  assert.ok(JSON.stringify(result.details).length < 200);
  checks++;
  return result;
}
assert.deepEqual(buildQuery({ exactPhrases: ['"hello world"'], excludeTerms: ['noise'], site:'https://example.com/docs/' }), { query:'"hello world" -"noise" site:example.com/docs', count:5 }); checks++;
for (const args of [{}, { query:'  ' }, { query:'x', count:0 }, { query:'x', count:1.5 }, { query:'x', count:11 }, { query:'x', site:'https://user:pass@example.com' }, { query:'x', site:'file:///tmp/x' }, { query:'x'.repeat(2001) }]) {
  await assert.rejects(search(args, undefined, () => { throw new Error('must not fetch'); })); checks++;
}
assert.equal((await run(json(packet('Result')))).content[0].text, 'Result');
assert.equal((await run(json({id:1,result:{content:[]}}))).content[0].text, 'No results found.');
for (const content of ['x'.repeat(300000), '🚀漢字'.repeat(10000), 'line\n'.repeat(1000)]) {
  const result = await run(json(packet(content)));
  assert.equal(result.details.truncated, true);
  assert.ok(!result.content[0].text.includes('\ufffd'));
}
// SSE split at byte boundaries, with notifications, CRLF and multiline data.
const event = ': ping\r\n\r\nevent: message\r\ndata: {"method":"notify"}\r\n\r\nevent: message\r\ndata: {"id":1,"result":\r\ndata: {"content":[{"type":"text","text":"Unicode 🚀"}]}}\r\n\r\n';
let cancelled = false;
const encoded = Buffer.from(event); let index = 0;
const stream = new ReadableStream({
  pull(controller) { if (index < encoded.length) controller.enqueue(encoded.subarray(index, ++index)); /* leave open after final event */ },
  cancel() { cancelled = true; },
});
assert.equal((await run(new Response(stream, {headers:{'content-type':'text/event-stream'}}))).content[0].text, 'Unicode 🚀');
assert.equal(cancelled,true);
for (const data of [{id:1,error:{message:'fixture RPC error'}}, {id:1,result:{isError:true,content:[{type:'text',text:'fixture tool error'}]}}, {id:1,result:{}}, {id:2,result:{content:[]}}, {id:1,result:{content:[{type:'image',data:'...'}]}}]) {
  await assert.rejects(run(json(data))); checks++;
}
await assert.rejects(run(new Response('<html>not JSON</html>'))); checks++;
for (const code of [429,403,500]) {
  await assert.rejects(run(new Response('sensitive server body must not be echoed', {status:code})), error => !error.message.includes('sensitive') && (code !==429 || /rate limit/.test(error.message))); checks++;
}
let stopped = false;
const huge = new Response(new ReadableStream({
  pull(controller) { controller.enqueue(new Uint8Array(64*1024)); },
  cancel() { stopped = true; },
}));
await assert.rejects(run(huge), /1 MiB/); assert.equal(stopped,true); checks++;
await assert.rejects(run(new Response('', {headers:{'content-length':String(MAX_RESPONSE_BYTES+1)}})), /1 MiB/); checks++;
const abort = new AbortController(); abort.abort();
await assert.rejects(search({query:'x'}, abort.signal, () => { throw new Error('must not fetch'); }), /cancelled/); checks++;
await assert.rejects(run(json({id:1,error:{message:'x'.repeat(50000)}})), error => Buffer.byteLength(error.message)<=2048); checks++;
console.log(`PASS: ${checks} offline cases: query validation, no-key request, JSON/SSE streaming, Unicode/output limits, errors, HTTP rate limits, oversized-body cancellation and pre-abort.`);
