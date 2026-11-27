import assert from "node:assert/strict";
import { isolate } from "./isolation.mjs";

const [sandbox, run, git, mode] = process.argv.slice(2);
assert(sandbox && run && git && ["state", "network"].includes(mode),
  "Usage: node run.mjs <sandbox> <run-t08-name> <git.exe> state|network");
if (mode === "state") {
  const { exerciseState } = await import("./state.mjs");
  const probe = isolate(sandbox, run, git);
  await probe.within({}, regular => exerciseState(probe, regular));
} else {
  const { exerciseNetwork } = await import("./network.mjs");
  await exerciseNetwork(sandbox, run, git);
}
