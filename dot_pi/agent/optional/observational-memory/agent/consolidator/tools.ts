// Scoped memory tools. No symlink traversal, hidden IPC access, unbounded reads,
// or shell interpolation. A separate completion receipt is required before the
// orchestrator can remove observations from its active buffer.
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { atomicWrite, MAX_MEMORY_FILE_BYTES, readMemoryText, resolveWithinMemory } from '../../src/memory/paths.js';
import { topicDigest, writeConsolidationReceipt } from '../../src/spawn/receipt.js';

type ToolText = { content: { type: 'text'; text: string }[]; details: unknown };
function bounded(text: string): string {
  const limit = 16 * 1024;
  if (Buffer.byteLength(text) <= limit && text.split('\n').length <= 400) return text;
  const suffix = '\n[Truncated. Narrow the search or use read offset/limit.]';
  const head = text.split('\n').slice(0, 398).join('\n');
  let clipped = Buffer.from(head).subarray(0, limit - Buffer.byteLength(suffix) - 3).toString('utf8');
  return clipped + suffix;
}
function ok(text: string, details: unknown = {}): ToolText { return { content: [{type:'text',text:bounded(text)}], details }; }
function fail(text: string): ToolText { return ok(`Error: ${text}`, {error:true}); }
function scoped(root: string, requested: string): string | undefined {
  const abs = resolveWithinMemory(root, requested);
  if (!abs) return undefined;
  const rel = relative(root, abs);
  if (rel && rel.split(sep).some(part => part.startsWith('.'))) return undefined;
  return abs;
}
function filesUnder(root: string, base: string, depth = 0, out: string[] = []): string[] {
  if (depth > 12 || out.length >= 200) return out;
  for (const entry of readdirSync(base, {withFileTypes:true})) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const path = scoped(root, join(base, entry.name));
    if (!path) continue;
    if (entry.isDirectory()) filesUnder(root, path, depth + 1, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(path);
    if (out.length >= 200) break;
  }
  return out;
}

export function registerConsolidatorTools(pi: ExtensionAPI, memoryRoot: string, receiptPath?: string): void {
  const root = resolve(memoryRoot);
  const touched = new Set<string>();
  const readSchema = Type.Object({
    path: Type.String({description:'Memory file path, e.g. auth.md. Hidden IPC paths are unavailable.'}),
    offset: Type.Optional(Type.Integer({minimum:1,description:'First line, 1-indexed.'})),
    limit: Type.Optional(Type.Integer({minimum:1,maximum:400,description:'Maximum lines, default 200.'})),
  });
  pi.registerTool({name:'read',label:'Read memory file',description:'Read a memory file (64 KiB file limit; bounded output; offset/limit supported).',parameters:readSchema,
    async execute(_id, params) {
      const path=scoped(root,params.path);if(!path)return fail('path escapes .memory/ or contains a symlink/hidden directory');
      try {
        const lines=readMemoryText(root,path).split('\n'),start=(params.offset??1)-1,end=start+(params.limit??200);
        return ok(lines.slice(start,end).join('\n')+(end<lines.length?`\n[More lines: continue with offset ${end+1}.]`:''));
      } catch {return fail('no such readable memory file, or file exceeds 64 KiB');}
    },
  });
  pi.registerTool({name:'write',label:'Write memory file',description:'Atomically write a topic .md file under .memory/ (maximum 64 KiB). INDEX.md is generated.',
    parameters:Type.Object({path:Type.String(),content:Type.String()}),
    async execute(_id,params) {
      const path=scoped(root,params.path);if(!path)return fail('path escapes .memory/ or contains a symlink/hidden directory');
      if(/(^|\/)INDEX\.md$/i.test(path))return fail('INDEX.md is generated automatically; do not write it');
      if(!path.endsWith('.md')||Buffer.byteLength(params.content)>MAX_MEMORY_FILE_BYTES)return fail('write requires a .md file no larger than 64 KiB');
      try {atomicWrite(path,params.content);touched.add(relative(root,path));return ok(`Wrote ${params.path} (${Buffer.byteLength(params.content)} bytes).`);}
      catch{return fail('memory write failed');}
    },
  });
  pi.registerTool({name:'edit',label:'Edit memory file',description:'Replace an exact unique substring in a memory .md file, atomically.',
    parameters:Type.Object({path:Type.String(),oldText:Type.String({minLength:1}),newText:Type.String()}),
    async execute(_id,params) {
      const path=scoped(root,params.path);if(!path)return fail('path escapes .memory/ or contains a symlink/hidden directory');
      if(/(^|\/)INDEX\.md$/i.test(path))return fail('INDEX.md is generated automatically; do not edit it');
      if(!path.endsWith('.md')||!params.oldText)return fail('edit requires a .md file and non-empty oldText');
      try {
        const current=readMemoryText(root,path),count=current.split(params.oldText).length-1;
        if(!count)return fail('oldText not found');if(count!==1)return fail(`oldText is ambiguous (${count} matches)`);
        const next=current.replace(params.oldText,()=>params.newText);
        if(Buffer.byteLength(next)>MAX_MEMORY_FILE_BYTES)return fail('edited file exceeds 64 KiB');
        atomicWrite(path,next);touched.add(relative(root,path));return ok(`Edited ${params.path}.`);
      }catch{return fail('no such readable memory file or edit failed');}
    },
  });
  pi.registerTool({name:'ls',label:'List memory files',description:'List non-hidden memory files; symlinks are excluded.',
    parameters:Type.Object({path:Type.Optional(Type.String())}),
    async execute(_id,params) {
      const path=scoped(root,params.path??'.');if(!path)return fail('path escapes .memory/ or contains a symlink/hidden directory');
      if(!existsSync(path))return ok('(.memory/ is empty)');
      try{return ok(readdirSync(path,{withFileTypes:true}).filter(e=>!e.name.startsWith('.')&&!e.isSymbolicLink()).map(e=>e.name).sort().join('\n')||'(empty)');}
      catch{return fail('not a readable memory directory');}
    },
  });
  pi.registerTool({name:'grep',label:'Search memory files',description:'Search memory .md files with a ripgrep regular expression (bounded output and a 3-second deadline).',
    parameters:Type.Object({pattern:Type.String(),path:Type.Optional(Type.String())}),
    async execute(_id,params) {
      const base=scoped(root,params.path??'.');if(!base)return fail('path escapes .memory/ or contains a symlink/hidden directory');
      if(!existsSync(base))return ok('(no matches)');
      let files:string[];
      try {files=base.endsWith('.md')?[base]:filesUnder(root,base);files=files.filter(f=>{try{readMemoryText(root,f);return true;}catch{return false;}});}
      catch{return fail('not a readable memory path');}
      if(!files.length)return ok('(no matches)');
      try {
        return ok(execFileSync('rg',['--no-config','--with-filename','--no-heading','--line-number','--max-count','200','--',params.pattern,...files],{encoding:'utf8',timeout:3000,maxBuffer:16*1024}));
      }catch(error:any){
        if(error.status===1)return ok('(no matches)');
        if(error.code==='ENOBUFS'&&error.stdout)return ok(String(error.stdout)+'\n[Truncated. Narrow the search.]');
        return fail('grep unavailable, timed out, or regex unsupported');
      }
    },
  });
  if (receiptPath) pi.registerTool({
    name:'finish_consolidation',label:'Confirm durable consolidation',
    description:'After writing topic files, explicitly acknowledge the observation IDs preserved in them. Unacknowledged observations stay in the buffer. Do not discard facts as noise.',
    parameters:Type.Object({
      observationTimestamps:Type.Array(Type.String({minLength:1}),{minItems:1,maxItems:1000}),
      files:Type.Array(Type.String({description:'Top-level topic filename written/edited this run, e.g. auth.md; not JOURNEY.md or INDEX.md.'}),{minItems:1,maxItems:100}),
    }),
    async execute(_id,params) {
      try {
        if(params.files.some(file=>!touched.has(file)))return fail('receipt may only reference topic files written/edited in this run');
        const files=params.files.map(path=>({path,sha256:topicDigest(root,path)}));
        writeConsolidationReceipt(receiptPath,{observationTimestamps:params.observationTimestamps,files});
        return ok(`Acknowledged ${params.observationTimestamps.length} observations in ${files.length} durable topic files. Finish with a short confirmation.`);
      }catch{return fail('receipt requires non-empty, readable topic files written in this run');}
    },
  });
}
