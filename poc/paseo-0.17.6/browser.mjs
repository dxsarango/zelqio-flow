import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Keep the original web isolation, selector and explicit/preselected comparison.
export async function exercise(probe, git, chrome) {
  const previous = name => readFileSync(new URL(`../paseo-0.17.5/${name}`, import.meta.url), "utf8");
  const driver = previous("browser.mjs");
  const actions = previous("browser-actions.js");
  const anchor = '    await send({ name: "browser-model", same: JSON.stringify(untouched) === JSON.stringify(selected), untouched, selected });';
  assert(actions.includes(anchor));
  const draft = `
    if (data("workspace-tab-switcher-trigger")) {
      await click(() => data("workspace-tab-switcher-trigger"), "workspace tab switcher");
      await click(() => data("workspace-tab-switcher-new-agent"), "third draft");
    } else {
      await click(() => data("workspace-new-tab-button"), "new tab menu");
      await click(() => data("workspace-new-tab-menu-agent") || data("workspace-new-tab-agent"), "third draft");
    }
    const draftState = () => {
      const node = data("probe-draft-state");
      return node && JSON.parse(node.textContent);
    };
    const before = await wait(() => draftState()?.model === "fixture-default" && draftState(), "plugin draft state");
    await click(() => button("Apply fixture draft"), "fixture composer item");
    const after = await wait(() => {
      const state = draftState();
      if (state?.error) throw new Error(state.error);
      return state?.model === "fixture-other" && state.metadata["zelqio-probe.draft"] && state;
    }, "applied model and metadata");
    const submission = await submit();
    if (submission.before.config.model !== "fixture-other" || !submission.before.metadata["zelqio-probe.draft"]) {
      throw new Error("Draft changes were absent from the native create request");
    }
    await send({ name: "E1-client", before, after, submission });
  `;
  const module = join(probe.fixture, "browser.mjs");
  writeFileSync(join(probe.fixture, "browser-actions.js"), actions.replace(anchor, anchor + draft));
  writeFileSync(module, driver.replace('import { createRepo, dirtyWorktree, installObserver } from "./retirement.mjs";',
    `import { createRepo, dirtyWorktree } from ${JSON.stringify(new URL("../paseo-0.17.5/retirement.mjs", import.meta.url).href)};`)
    .replace(/  installObserver\(probe\);\r?\n/, "")
    .replace('"./client.mjs"', JSON.stringify(new URL("./client.mjs", import.meta.url).href))
    .replace('"./isolation.mjs"', JSON.stringify(new URL("./isolation.mjs", import.meta.url).href)));
  const { exercise: run } = await import(pathToFileURL(module).href);
  return run(probe, git, chrome, "model");
}
