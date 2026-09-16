// Loads through the installed Pi loader. Command strings are NEVER executed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
let packageDir = process.env.PI_CODING_AGENT_PACKAGE;
if (!packageDir) {
  try {
    packageDir = dirname(require.resolve("@earendil-works/pi-coding-agent/package.json"));
  } catch {
    const besideNode = resolve(dirname(process.execPath), "../lib/node_modules/@earendil-works/pi-coding-agent");
    if (existsSync(join(besideNode, "package.json"))) {
      packageDir = besideNode;
    } else {
      const env = { ...process.env };
      delete env.npm_config_prefix; // npm --prefix test scripts inherit this override
      const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8", env }).trim();
      packageDir = join(root, "@earendil-works/pi-coding-agent");
    }
  }
}
const { loadExtensions } = await import(pathToFileURL(join(packageDir, "dist/core/extensions/loader.js")));
const entry = resolve(dirname(fileURLToPath(import.meta.url)), "../index.ts");
const loaded = await loadExtensions([entry], process.cwd());
assert.deepEqual(loaded.errors, []);
const factory = loaded.extensions[0];
let checks = 0;

// Each fixture reloads with isolated extension state, no session/LLM or shell execution.
async function fixture({ flags = {}, depth = "0", hasUI = false } = {}) {
  const previous = process.env.PI_SUBAGENT_DEPTH;
  process.env.PI_SUBAGENT_DEPTH = depth;
  let result;
  try {
    result = await loadExtensions([entry], process.cwd());
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENT_DEPTH;
    else process.env.PI_SUBAGENT_DEPTH = previous;
  }
  assert.deepEqual(result.errors, []);
  const extension = result.extensions[0];
  for (const [key, value] of Object.entries(flags)) result.runtime.flagValues.set(key, value);
  const messages = [];
  const statuses = [];
  let prompts = 0;
  let answer = "Abort";
  const ctx = {
    hasUI, mode: hasUI ? "rpc" : "print",
    ui: {
      notify: (text) => messages.push(text),
      setStatus: (_key, text) => statuses.push(text),
      select: async (_title, options) => {
        assert.deepEqual(options, ["Abort", "Run"]);
        prompts++;
        return answer;
      },
    },
  };
  async function start(reason = "startup") {
    for (const handler of extension.handlers.get("session_start") ?? []) await handler({ reason }, ctx);
  }
  async function inspect(command, blocked, toolName = "bash") {
    let response;
    for (const handler of extension.handlers.get("tool_call") ?? []) {
      response = await handler({ toolName, input: { command } }, ctx);
      if (response?.block) break;
    }
    assert.equal(Boolean(response?.block), blocked, `${JSON.stringify(command)}: ${JSON.stringify(response)}`);
    checks++;
    return response;
  }
  await start();
  return {
    inspect, start, messages, statuses,
    command: (args) => extension.commands.get("bash-guard").handler(args, ctx),
    answer: (value) => { answer = value; },
    prompts: () => prompts,
  };
}

assert.ok(factory.flags.has("bash-guard-enabled"));
const off = await fixture({ hasUI: true });
for (const command of ["ls", "git status", "git commit -m test", "git pull", "git push", "ls | head", "printf hello > output", "rm example"]) {
  await off.inspect(command, false);
}
for (const command of ["rm -rf example", "/bin/rm -fr example", "rm --recursive example", "sudo true", "git reset --hard", "git clean -fd", "git push --force", "git push --force-with-lease=main:abc", "git push -f origin main", "git push origin +main", "echo safe\nrm -rf example", "rm -\\\nrf example"]) {
  await off.inspect(command, true);
}
await off.inspect("rm -rf example", false, "write");
assert.equal(off.prompts(), 0);
await off.command("status");
assert.match(off.messages.at(-1), /OFF/);
await off.command("nonsense");
assert.match(off.messages.at(-1), /Usage/);
await off.inspect("git status", false);
await off.command("on");
off.answer("Run");
await off.inspect("git status", false);
assert.equal(off.prompts(), 1);
await off.command("on"); // idempotent, not a toggle
await off.inspect("git status", false);
assert.equal(off.prompts(), 2);
await off.command("off");
await off.command("off");
await off.inspect("git status", false);
assert.equal(off.prompts(), 2);
await off.command(""); // backward-compatible toggle
await off.inspect("git status", false);
assert.equal(off.prompts(), 3);
await off.start("reload");
await off.inspect("git status", false);
assert.equal(off.prompts(), 3);
assert.equal(off.statuses.at(-1), "BG off · floor on");

const on = await fixture({ flags: { "bash-guard-enabled": true } });
for (const command of ["rm example", "/bin/rm example", "echo safe\nrm example", "echo safe # comment\n/bin/rm example", "echo safe & /bin/rm example", "ls | /bin/rm example", "rm \\\nexample"]) {
  await on.inspect(command, true);
}
for (const command of ["ls", "echo 'hello\nrm example'", 'echo "hello\nrm example"', "echo safe # rm example", 'printf "%s" "escaped \\\" quote"']) {
  await on.inspect(command, false);
}
const override = await fixture({ flags: { "bash-guard-enabled": true, "bash-guard-disabled": true } });
await override.inspect("git status", false);
const auto = await fixture({ flags: { "bash-guard-enabled": true, "bash-guard-auto-allow": true } });
await auto.inspect("git status", false);
await auto.inspect("rm -rf example", true);
const interactive = await fixture({ hasUI: true, flags: { "bash-guard-enabled": true, "bash-guard-auto-allow": true } });
await interactive.inspect("git status", true);
await interactive.inspect("git status", true);
assert.equal(interactive.prompts(), 1); // recent refusal remembered
await interactive.command("off");
await interactive.command("on");
interactive.answer("Run");
await interactive.inspect("git status", false);
await interactive.inspect("rm -rf example", false); // explicit interactive approval
interactive.answer(undefined);
await interactive.inspect("git diff", true); // cancelled dialog fails closed

const subagent = await fixture({ depth: "1" });
for (const command of ["git commit -m test", "git pull", "git push", "/bin/rm -rf example", "sudo true"]) await subagent.inspect(command, true);
for (const command of ["git status", "ls"]) await subagent.inspect(command, false);
console.log(`PASS: ${checks} command checks plus loading, flags, defaults, toggles, reload, RPC dialogs, refusal memory and subagent assertions.`);
