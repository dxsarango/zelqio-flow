import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { isolate, port } from "./isolation.mjs";

const [, , sandbox, run, git, phase, ...args] = process.argv;
assert(sandbox && run && git && ["bootstrap", "compatibility", "retirement", "browser", "loop"].includes(phase));
const probe = isolate(sandbox, run, git);
const before = probe.listener(6767);
assert(before.length <= 1 && before.every(row => row.address === "127.0.0.1:6767"));
assert.deepEqual(probe.listener(port), []);
assert.deepEqual(probe.listener(16777), []);
probe.initialize();
try {
  if (phase === "browser") {
    probe.checked("daemon", "config", "set", "features.webUi.enabled", "true");
    probe.checked("daemon", "config", "set", "daemon.cors.allowedOrigins", '["http://127.0.0.1:16776"]');
  }
  if (phase === "retirement") {
    probe.checked("daemon", "config", "set", "worktrees.root", "configured-worktrees");
  }
  console.log(JSON.stringify({ start: probe.start() }));
  if (["loop", "browser"].includes(phase)) {
    probe.checked("plugin", "install", fileURLToPath(new URL("./poc-plugin", import.meta.url)));
  }
  if (phase !== "bootstrap") {
    const { exercise } = await import(`./${phase}.mjs`);
    await exercise(probe, git, ...args);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    probe.stop();
  } finally {
    const after = probe.listener(6767);
    const isolated = probe.listener(port);
    console.log(JSON.stringify({ before, after, isolated }));
    assert.deepEqual(after, before);
    assert.deepEqual(isolated, []);
  }
}
