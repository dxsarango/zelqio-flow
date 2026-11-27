import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Reuse the archive, dependency swap, check and RPC driver from 0.17.5.
export async function exercise(probe, ...args) {
  const source = readFileSync(new URL("../paseo-0.17.5/compatibility.mjs", import.meta.url), "utf8");
  assert(source.includes('"0.17.5"') && source.includes('"./client.mjs"'));
  const module = join(probe.fixture, "compatibility.mjs");
  writeFileSync(module, source.replaceAll('"0.17.5"', '"0.17.6"')
    .replace('"./client.mjs"', JSON.stringify(new URL("./client.mjs", import.meta.url).href)));
  const { exercise: run } = await import(pathToFileURL(module).href);
  return run(probe, ...args);
}
