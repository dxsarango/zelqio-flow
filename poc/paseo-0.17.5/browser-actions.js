// Runs in a throwaway browser profile against the bundled web UI only.
addEventListener("load", () => {
  void exercise();
}, { once: true });

async function exercise() {
  const cfg = globalThis.fixture;
  const send = result => fetch("/probe-result", { method: "POST", body: JSON.stringify(result) });
  const traces = async () => (await fetch("/probe-observations")).json();
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const data = id => [...document.querySelectorAll(`[data-testid="${id}"]`)].find(node => node.getClientRects().length);
  const bySuffix = (prefix, id) => document.querySelector(`[data-testid^="${prefix}"][data-testid$="${id}"]`);
  const row = id => bySuffix("sidebar-workspace-row-", id);
  const button = label => [...document.querySelectorAll("button,[role=button],[role=option]")].find(node =>
    node.getBoundingClientRect().width && (node.getAttribute("aria-label") === label || node.textContent.trim() === label));
  let archiveWarning;
  // Respond to exactly the destructive browser dialog for these two disposable worktrees.
  globalThis.confirm = message => {
    if (!/^Archive 2 workspaces\?/i.test(message) || !/web-first:.*uncommitted changes/i.test(message) ||
      !/web-second:.*uncommitted changes/i.test(message)) return false;
    archiveWarning = message;
    return true;
  };
  async function wait(read, name) {
    const end = Date.now() + 6500;
    do {
      const result = await read();
      if (result) return result;
      await delay(100);
    } while (Date.now() < end);
    throw Error(`Missing ${name}`);
  }
  async function click(read, name) {
    const node = await wait(read, name);
    node.click();
  }
  async function step(name, run) {
    try {
      await run();
    } catch (error) {
      await send({ name, error: String(error), text: document.body.innerText.slice(0, 1800),
        combo: data("combined-model-selector")?.outerHTML.slice(0, 900),
        controls: [...document.querySelectorAll("[data-testid],[aria-label]")].map(node =>
          node.getAttribute("data-testid") ?? node.getAttribute("aria-label")).slice(0, 120) });
    }
  }
  await step("browser-connection", async () => {
    await wait(() => row(cfg.local) || data("welcome-direct-connection"), "workspace or connection screen");
    if (row(cfg.local)) return;
    await click(() => data("welcome-direct-connection"), "direct connection");
    for (const [id, value] of [["direct-host-input", "127.0.0.1"], ["direct-port-input", "16775"]]) {
      const input = await wait(() => data(id), id);
      input.focus();
      input.select();
      if (!document.execCommand("insertText", false, value) || input.value !== value) throw Error(`Unable to populate ${id}`);
    }
    await click(() => data("direct-host-submit"), "connect to isolated daemon");
    const destination = await wait(() => row(cfg.local) || data("host-confirmation-connect"), "workspace or host confirmation");
    if (destination === data("host-confirmation-connect")) {
      await click(() => data("host-confirmation-connect"), "confirm isolated host");
      await wait(() => row(cfg.local), "workspace after connecting");
    }
  });
  await step("browser-model", async () => {
    await click(() => row(cfg.local), "fixture workspace");
    const combo = () => data("combined-model-selector");
    const input = () => data("message-input-root")?.querySelector('[contenteditable="true"],textarea');
    if (!combo()) await click(() => data("workspace-new-tab-agent"), "new agent");
    await wait(combo, "model selector");
    const label = () => data("combined-model-selector-model-label")?.textContent.trim() ??
      combo()?.getAttribute("aria-label");
    async function submit() {
      const prior = await traces();
      const existing = new Set(prior.filter(row => row.hook === "agent.open.before").map(row => row.value.agentId));
      const editor = await wait(input, "composer");
      editor.focus();
      if (!document.execCommand("insertText", false, "fixture ok")) throw Error("Unable to type fixture message");
      await click(() => button("Send message"), "send");
      return wait(async () => {
        const rows = await traces();
        const opened = rows.find(row => row.hook === "agent.open.before" && row.value.reason === "create" &&
          !existing.has(row.value.agentId));
        if (!opened) return null;
        const index = rows.indexOf(opened);
        const created = rows.slice(0, index).findLast(row => row.hook === "agent.create.before");
        if (!created) return null;
        const { agentId, ...open } = opened.value;
        return { before: created.value, open };
      }, "creation and open hooks");
    }
    const initialLabel = await wait(() => label() && !label().includes("Loading") && label(), "settled initial model field");
    const trigger = await wait(combo, "model selector");
    trigger.focus();
    const rect = trigger.getBoundingClientRect();
    const options = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse", isPrimary: true,
      clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
    for (const type of ["pointerdown", "pointerup"]) trigger.dispatchEvent(new PointerEvent(type, options));
    trigger.click();
    await click(() => data("model-provider-zelqio-fixture"), "synthetic provider");
    await click(() => data("model-row-zelqio-fixture-fixture-default"), "explicit default model");
    await wait(() => label()?.includes("Fixture default"), "selected synthetic model");
    const selected = await submit();
    await send({ name: "browser-model-explicit", initialLabel, selected });
    if (data("workspace-tab-switcher-trigger")) {
      await click(() => data("workspace-tab-switcher-trigger"), "workspace tab switcher");
      await click(() => data("workspace-tab-switcher-new-agent"), "second new agent draft");
    } else {
      await click(() => data("workspace-new-tab-button"), "new tab menu");
      await click(() => data("workspace-new-tab-menu-agent") || data("workspace-new-tab-agent"), "second new agent draft");
    }
    await wait(() => document.querySelector('[data-testid^="workspace-tab-draft_"]'), "second draft tab");
    const nextDraftLabel = await wait(() => label() && !label().includes("Loading") && label(), "settled second model field");
    if (!nextDraftLabel.includes("Fixture default")) {
      await send({ name: "browser-model-default", submitted: false, nextDraftLabel });
      return;
    }
    const untouched = await submit();
    await send({ name: "browser-model", same: JSON.stringify(untouched) === JSON.stringify(selected), untouched, selected });
  });
  if (cfg.worktrees.length) await step("browser-bulk-archive", async () => {
    const [firstId, secondId] = cfg.worktrees;
    const first = await wait(() => row(firstId), "first worktree");
    const rect = first.getBoundingClientRect();
    first.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2,
      clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
    await click(() => bySuffix("sidebar-workspace-menu-select-", firstId), "selection menu");
    await click(() => row(secondId), "second worktree");
    await wait(() => /2/.test(data("workspace-selection-count")?.textContent ?? ""), "two selected worktrees");
    await click(() => data("workspace-selection-archive"), "archive action");
    const confirmation = await wait(() => archiveWarning, "dirty worktree confirmation");
    await send({ name: "browser-bulk-archive", archiveAccepted: true, warning: confirmation.split("\n")
      .filter(line => /archive|uncommitted/i.test(line)).slice(-12) });
  });
  await send({ finished: true });
}
