import assert from "node:assert/strict";
import { isolate } from "./isolation.mjs";

const [, , sandbox, run, git, phase = "bootstrap", ...args] = process.argv;
assert(sandbox && run && git, "Pass the sandbox, a fresh run ID and the explicit Git executable");
const probe = isolate(sandbox, run, git);
const before = probe.listener(6767);
assert(before.length <= 1 && before.every(row => row.address === "127.0.0.1:6767"));
assert.deepEqual(probe.listener(16775), []);
probe.initialize();
try {
  if (phase === "browser") {
    probe.checked("daemon", "config", "set", "features.webUi.enabled", "true");
    probe.checked("daemon", "config", "set", "daemon.cors.allowedOrigins", '["http://127.0.0.1:16776"]');
  }
  console.log(JSON.stringify({ start: probe.start() }));
  if (phase !== "bootstrap") {
    assert(["sessions", "retirement", "compatibility", "browser"].includes(phase));
    const { exercise } = await import(`./${phase}.mjs`);
    await exercise(probe, git, ...args);
  }
} finally {
  try {
    probe.stop();
  } finally {
    const after = probe.listener(6767);
    const isolated = probe.listener(16775);
    console.log(JSON.stringify({ before, after, isolated }));
    assert.deepEqual(after, before);
    assert.deepEqual(isolated, []);
  }
}
