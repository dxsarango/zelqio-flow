// Models of two designs for automatic routing. No dependencies, no Paseo.
//   C: observe the native draft, write the model into it and attest with a metadata record.
//   D: a Zelqio-owned launcher: the Zelqio server is the only author of the creation request.
// It encodes the documented semantics of the SDK as rules and checks what each design can and cannot
// distinguish. It is NOT a measurement of Paseo behaviour: runtime behaviour is covered separately.
// Section C runs with draft writes enabled only to demonstrate why they must stay disabled.
// Usage: node simulate.mjs
import { deepStrictEqual } from "node:assert";

// ---- Paseo side (documented semantics) ------------------------------------------------------------
// - PluginComposer exposes provider/model/mode/options/metadata, no source or origin of a value.
// - A command acts on the composer state when it runs. Draft metadata is sent with the creation request.
// - The creation hook receives config and metadata as sent, plus a read-only workspaceId (0.17.5).
function createDraft(initial) {
  const listeners = new Set();
  const state = { provider: initial.provider, model: initial.model, mode: initial.mode ?? null, options: { ...initial.options }, metadata: {} };
  const snapshot = () => structuredClone(state);
  const notify = () => { for (const fn of listeners) fn(snapshot()); };
  return {
    state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    snapshot,
    // Commands used by Zelqio. They resolve after the change took effect.
    async setModel(model) { state.model = model; notify(); },
    async setMetadata(patch) {
      for (const [k, v] of Object.entries(patch)) { if (v === null) delete state.metadata[k]; else state.metadata[k] = v; }
      notify();
    },
    // User actions through the native selectors. Indistinguishable from plugin commands in snapshots.
    userSelectModel(model) { state.model = model; notify(); },
    hostDefaultChanges(model) { state.model = model; notify(); },
    toCreationRequest() { return { config: { provider: state.provider, model: state.model, modeId: state.mode, providerOptions: { ...state.options } }, metadata: structuredClone(state.metadata), workspaceId: "ws-1" }; },
  };
}

// ---- Client side: the composer item (one instance per composer) ------------------------------------
const KEY = "zelqio-flow.selection";
function createTracker(draft, { mountedFromStart = true } = {}) {
  const t = { baseline: mountedFromStart ? draft.snapshot() : null, touched: false, expected: null, lastModel: draft.snapshot().model, mounted: true, stop: null };
  t.stop = draft.subscribe((s) => {
    if (!t.mounted) return; // an unmounted item observes nothing (phone overflow sheet)
    if (s.model !== t.lastModel) {
      if (t.expected !== null && s.model === t.expected) t.expected = null; // our own command
      else t.touched = true; // any other transition is treated as a manual change (fail-safe direction)
      t.lastModel = s.model;
    }
  });
  return t;
}

// ---- Server side: registry of issued proposals and hook classification ------------------------------
function createServer({ now = () => 1000, revalidate = () => "ok" } = {}) {
  const issued = new Map(); // nonce -> { provider, model, revision, validUntil, consumed }
  let counter = 0;
  return {
    propose(provider, model, baseline) {
      const nonce = `n${++counter}`;
      // The baseline is stored server side at proposal time. A restore never trusts the record.
      issued.set(nonce, { provider, model, baseline, revision: "r1", validUntil: now() + 60_000, consumed: false });
      return { nonce, provider, model, revision: "r1" };
    },
    restart() { issued.clear(); },
    // agent.create.before: classify, then decide. Returns { cls, config, action }.
    hook(request) {
      const record = request.metadata[KEY];
      const { config } = request;
      const keep = (cls) => ({ cls, action: "keep", config });
      if (!record || typeof record !== "object" || record.version !== 1) return keep("unknown_default_or_manual");
      if (record.origin === "supervised") return keep("manual_assisted");
      if (record.touched === true) return keep("manual_observed");
      if (config.provider !== record.provider || config.model !== record.model) return keep("manual_after_recommendation");
      const entry = issued.get(record.nonce);
      if (!entry || entry.consumed || entry.provider !== record.provider || entry.model !== record.model) return keep("unverifiable_record");
      entry.consumed = true;
      if (now() >= entry.validUntil || revalidate(record) !== "ok") {
        // Managed by Zelqio and no longer valid: restore what the host would have used.
        return { cls: "managed_stale", action: "restore_baseline", config: { ...config, model: entry.baseline.model } };
      }
      return { cls: "managed", action: "pass", config };
    },
  };
}

// Client behaviour when Automatic is on: apply only to an untouched, observed default.
const gate = { writesEnabled: false }; // draft writes are disabled unless a scenario opts in
async function applyAutomatic(draft, tracker, server, candidateModel, { raceBeforeSet } = {}) {
  if (!gate.writesEnabled) return "disabled";
  if (!tracker.baseline || tracker.touched) return "skipped";
  const proposal = server.propose(draft.state.provider, candidateModel, { provider: tracker.baseline.provider, model: tracker.baseline.model });
  if (raceBeforeSet) raceBeforeSet(); // user edit that lands after the last check
  if (tracker.touched) return "aborted_user_edit";
  tracker.expected = candidateModel;
  await draft.setModel(candidateModel);
  await draft.setMetadata({ [KEY]: { version: 1, origin: "auto", provider: proposal.provider, model: candidateModel, revision: proposal.revision, nonce: proposal.nonce, appliedAt: 1000, baseline: { provider: tracker.baseline.provider, model: tracker.baseline.model }, touched: false } });
  return "applied";
}
// What an observing item does when it sees a manual change after applying.
async function markSuperseded(draft, tracker) {
  const record = draft.state.metadata[KEY];
  if (record && tracker.touched) await draft.setMetadata({ [KEY]: { ...record, touched: true } });
}

// ---- Scenarios -------------------------------------------------------------------------------------
const init = { provider: "p", model: "native-default", mode: "review", options: { effort: "low" } };
const results = [];
async function scenario(id, title, run, expected) {
  let actual;
  try { actual = await run(); } catch (error) { actual = { error: String(error) }; }
  let ok = true;
  try { deepStrictEqual(actual, expected); } catch { ok = false; }
  results.push({ id, title, ok, actual, expected });
}

await scenario("G0", "C: with draft writes disabled (the proposed state) nothing is written and the hook preserves the choice", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  const applied = await applyAutomatic(draft, tracker, server, "routed");
  const out = server.hook(draft.toCreationRequest());
  return { applied, cls: out.cls, action: out.action, model: out.config.model };
}, { applied: "disabled", cls: "unknown_default_or_manual", action: "keep", model: "native-default" });

gate.writesEnabled = true; // demonstration only: scenarios S1..R3 and F1..F4 below

await scenario("S1", "Automatic on an untouched, observed default: applied, revalidated and passed", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  const applied = await applyAutomatic(draft, tracker, server, "routed");
  const out = server.hook(draft.toCreationRequest());
  return { applied, cls: out.cls, action: out.action, model: out.config.model };
}, { applied: "applied", cls: "managed", action: "pass", model: "routed" });

await scenario("S2", "User chose a model before the item applied (observed): never overwritten", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  draft.userSelectModel("user-pick");
  const applied = await applyAutomatic(draft, tracker, server, "routed");
  const out = server.hook(draft.toCreationRequest());
  return { applied, cls: out.cls, model: out.config.model };
}, { applied: "skipped", cls: "unknown_default_or_manual", model: "user-pick" });

await scenario("S3", "User changes the model after Zelqio applied it (observed): preserved", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  await applyAutomatic(draft, tracker, server, "routed");
  draft.userSelectModel("user-pick");
  await markSuperseded(draft, tracker);
  const out = server.hook(draft.toCreationRequest());
  return { cls: out.cls, action: out.action, model: out.config.model };
}, { cls: "manual_observed", action: "keep", model: "user-pick" });

await scenario("S3b", "Same change while the item was unmounted: record no longer matches, preserved", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  await applyAutomatic(draft, tracker, server, "routed");
  tracker.mounted = false;
  draft.userSelectModel("user-pick");
  const out = server.hook(draft.toCreationRequest());
  return { cls: out.cls, action: out.action, model: out.config.model };
}, { cls: "manual_after_recommendation", action: "keep", model: "user-pick" });

await scenario("S4", "User explicitly picks the SAME value as the host default (before apply): indistinguishable from default", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  draft.userSelectModel("native-default"); // no state transition: model already equals the default
  const applied = await applyAutomatic(draft, tracker, server, "routed");
  return { applied, touched: tracker.touched, model: draft.state.model };
}, { applied: "applied", touched: false, model: "routed" }); // documented residual risk R1

await scenario("S5", "User changes away and back to the recorded model while unmounted: looks managed", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  await applyAutomatic(draft, tracker, server, "routed");
  tracker.mounted = false;
  draft.userSelectModel("user-pick");
  draft.userSelectModel("routed");
  const out = server.hook(draft.toCreationRequest());
  return { cls: out.cls, model: out.config.model };
}, { cls: "managed", model: "routed" }); // documented residual risk R2 (same value, harmless unless revalidation fails)

await scenario("S6", "Item mounted after the user already interacted (phone overflow): no baseline, nothing applied", async () => {
  const draft = createDraft(init), server = createServer();
  draft.userSelectModel("user-pick");
  const tracker = createTracker(draft, { mountedFromStart: false });
  const applied = await applyAutomatic(draft, tracker, server, "routed");
  return { applied, model: draft.state.model };
}, { applied: "skipped", model: "user-pick" });

await scenario("S7", "Quota or policy changed between apply and send: hook restores the recorded baseline", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer({ revalidate: () => "quota_exhausted" });
  await applyAutomatic(draft, tracker, server, "routed");
  const out = server.hook(draft.toCreationRequest());
  return { cls: out.cls, action: out.action, model: out.config.model };
}, { cls: "managed_stale", action: "restore_baseline", model: "native-default" });

await scenario("S8", "Forged record without an issued nonce is not blessed", async () => {
  const draft = createDraft(init), server = createServer();
  await draft.setMetadata({ [KEY]: { version: 1, origin: "auto", provider: "p", model: "native-default", revision: "r1", nonce: "forged", baseline: { provider: "p", model: "x" }, touched: false } });
  const out = server.hook(draft.toCreationRequest());
  return { cls: out.cls, action: out.action, model: out.config.model };
}, { cls: "unverifiable_record", action: "keep", model: "native-default" });

await scenario("S9", "Replay of a consumed nonce is not blessed", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  await applyAutomatic(draft, tracker, server, "routed");
  const request = draft.toCreationRequest();
  server.hook(request);
  const out = server.hook(request);
  return { cls: out.cls, action: out.action };
}, { cls: "unverifiable_record", action: "keep" });

await scenario("S10", "User edit during the proposal round trip (seen by the item): apply aborted", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  const applied = await applyAutomatic(draft, tracker, server, "routed", { raceBeforeSet: () => draft.userSelectModel("user-pick") });
  return { applied, model: draft.state.model };
}, { applied: "aborted_user_edit", model: "user-pick" });

await scenario("S11", "RESIDUAL: daemon restart loses the registry: record unverifiable, model kept unverified", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  await applyAutomatic(draft, tracker, server, "routed");
  server.restart();
  const out = server.hook(draft.toCreationRequest());
  return { cls: out.cls, action: out.action, model: out.config.model };
}, { cls: "unverifiable_record", action: "keep", model: "routed" });

await scenario("S12", "Host default changes under the item after mount: seen as a manual change, nothing applied", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  draft.hostDefaultChanges("new-host-default");
  const applied = await applyAutomatic(draft, tracker, server, "routed");
  return { applied, model: draft.state.model };
}, { applied: "skipped", model: "new-host-default" });

await scenario("S13", "SDK or CLI creation without any composer record: unknown, kept", async () => {
  const server = createServer();
  const out = server.hook({ config: { provider: "p", model: "anything" }, metadata: {}, workspaceId: "ws-1" });
  return { cls: out.cls, action: out.action };
}, { cls: "unknown_default_or_manual", action: "keep" });

await scenario("S14", "Supervised (user pressed Apply) is an explicit choice: never overridden", async () => {
  const draft = createDraft(init), server = createServer();
  await draft.setModel("routed");
  await draft.setMetadata({ [KEY]: { version: 1, origin: "supervised", provider: "p", model: "routed", revision: "r1", nonce: "n0", touched: false } });
  const out = server.hook(draft.toCreationRequest());
  return { cls: out.cls, action: out.action, model: out.config.model };
}, { cls: "manual_assisted", action: "keep", model: "routed" });

// Known residual: a user edit that lands after the item's last check but before the command runs is
// overwritten, because commands act on the state at execution time. The model demonstrates the window.
await scenario("R3", "RESIDUAL: user edit between the last check and setModel is overwritten (one-frame window)", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  const proposal = server.propose("p", "routed", { provider: "p", model: "native-default" });
  const checked = !tracker.touched; // the item checks here
  draft.userSelectModel("user-pick"); // user edit lands in the window; the item has not rendered it yet
  tracker.touched = false; // the item has not processed the transition yet
  if (checked) { tracker.expected = "routed"; await draft.setModel("routed"); }
  return { model: draft.state.model, proposalIssued: Boolean(proposal.nonce) };
}, { model: "routed", proposalIssued: true });


// ---- Review findings reproduced against C ------------------------------------------------------------
await scenario("F1", "UNSAFE C: user explicitly re-selects the model Zelqio applied (no state transition); revalidation then replaces it", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer({ revalidate: () => "quota_exhausted" });
  await applyAutomatic(draft, tracker, server, "routed");
  draft.userSelectModel("routed"); // explicit pick of the same value: the snapshot does not change
  const out = server.hook(draft.toCreationRequest());
  return { touched: tracker.touched, cls: out.cls, action: out.action, model: out.config.model };
}, { touched: false, cls: "managed_stale", action: "restore_baseline", model: "native-default" });

await scenario("F2", "UNSAFE C: a still-live nonce copied by another client or plugin is consumed first; the real submit is unverifiable", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  await applyAutomatic(draft, tracker, server, "routed");
  const real = draft.toCreationRequest();
  const copy = structuredClone(real);
  const copyOut = server.hook(copy); // another creation path submits the copied record first
  const realOut = server.hook(real);
  return { copyCls: copyOut.cls, realCls: realOut.cls };
}, { copyCls: "managed", realCls: "unverifiable_record" });

await scenario("F3", "UNSAFE C: setModel succeeds but setMetadata fails; the write reaches Send without its record", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  const failing = { ...draft, setModel: draft.setModel, setMetadata: async () => { throw new Error("metadata rejected"); } };
  let error = null;
  try { await applyAutomatic(failing, tracker, server, "routed"); } catch (e) { error = e.message; }
  const out = server.hook(draft.toCreationRequest());
  return { error, model: out.config.model, cls: out.cls };
}, { error: "metadata rejected", model: "routed", cls: "unknown_default_or_manual" });

await scenario("F4", "UNSAFE C: the hook cannot see the final route; a later hook may change it after Zelqio validated", async () => {
  const draft = createDraft(init), tracker = createTracker(draft), server = createServer();
  await applyAutomatic(draft, tracker, server, "routed");
  const out = server.hook(draft.toCreationRequest()); // Zelqio validates here
  const finalConfig = { ...out.config, model: "changed-by-later-hook" }; // a later plugin hook rewrites the model
  return { validated: out.cls, finalModel: finalConfig.model, zelqioNotified: false };
}, { validated: "managed", finalModel: "changed-by-later-hook", zelqioNotified: false });

gate.writesEnabled = false;

// ---- Option D: Zelqio-owned launcher ---------------------------------------------------------------------
// The Zelqio server creates the agent. Nonces live only in server memory and in the creation request.
function createPlatform({ laterHook } = {}) {
  const agents = [];
  const hooks = [];
  return {
    agents, hooks,
    // Models agent.create.before hooks in order, then agent creation without a first prompt.
    createAgent(request) {
      let current = structuredClone(request);
      for (const hook of hooks) {
        const out = hook(current);
        if (out?.reject) return { error: out.reject };
        if (out) current = out;
      }
      if (laterHook) current = laterHook(current);
      const agent = { id: `a${agents.length + 1}`, snapshot: { ...current.config }, metadata: current.metadata, prompts: [] };
      agents.push(agent);
      return { agent };
    },
    send(agent, text) { agent.prompts.push(text); },
  };
}
function createLauncher(platform, { policy = () => ({ ok: true, model: "routed" }), now = () => 1000 } = {}) {
  const inflight = new Map(); // nonce -> intended config
  let counter = 0;
  platform.hooks.push((request) => {
    const record = request.metadata["zelqio-flow.launch"];
    if (!record) return undefined; // not a Zelqio creation: native, preserved
    const intended = inflight.get(record.nonce);
    if (!intended || intended.consumed) return undefined; // unknown or replayed: native, never blessed
    intended.consumed = true; // single process: check and consume are atomic
    const c = request.config;
    if (c.provider !== intended.config.provider || c.model !== intended.config.model || c.modeId !== intended.config.modeId
      || JSON.stringify(c.providerOptions) !== JSON.stringify(intended.config.providerOptions)) return { reject: "config_mismatch" };
    return undefined;
  });
  return {
    inflight,
    // The user clicked Start on the Zelqio form.
    async start(form) {
      const decision = form.model === "auto" ? policy() : { ok: true, model: form.model, manual: true };
      if (!decision.ok) return { status: "blocked", reason: decision.reason, agents: platform.agents.length };
      const nonce = `l${++counter}`;
      const config = { provider: form.provider, model: decision.model, modeId: form.modeId, providerOptions: { ...form.options } };
      inflight.set(nonce, { config, consumed: false });
      const created = platform.createAgent({
        config,
        metadata: { "zelqio-flow.launch": { version: 1, nonce, origin: decision.manual ? "launcher_manual" : "launcher_auto", requestedAt: now() } },
        workspaceId: form.workspaceId,
      });
      if (created.error) return { status: "rejected", reason: created.error, prompts: 0 };
      // Verify the effective configuration of the idle agent before any inference.
      const s = created.agent.snapshot;
      if (s.provider !== config.provider || s.model !== config.model || s.modeId !== config.modeId
        || JSON.stringify(s.providerOptions) !== JSON.stringify(config.providerOptions)) {
        return { status: "stopped_before_prompt", prompts: created.agent.prompts.length, model: s.model };
      }
      platform.send(created.agent, form.prompt);
      return { status: "started", model: s.model, prompts: created.agent.prompts.length, origin: created.agent.metadata["zelqio-flow.launch"].origin };
    },
  };
}
const form = { provider: "p", model: "auto", modeId: "review", options: { effort: "low" }, workspaceId: "ws-1", prompt: "hello" };

await scenario("D1", "Launcher, Automatic: Zelqio is the sole author; verified idle agent, then the prompt", async () => {
  const platform = createPlatform(), launcher = createLauncher(platform);
  return launcher.start(form);
}, { status: "started", model: "routed", prompts: 1, origin: "launcher_auto" });

await scenario("D2", "Launcher: a later hook rewrites the model; detected before the first prompt", async () => {
  const platform = createPlatform({ laterHook: (r) => ({ ...r, config: { ...r.config, model: "changed-by-later-hook" } }) }), launcher = createLauncher(platform);
  return launcher.start(form);
}, { status: "stopped_before_prompt", prompts: 0, model: "changed-by-later-hook" });

await scenario("D3", "Launcher: stale policy or quota blocks before any agent exists", async () => {
  const platform = createPlatform(), launcher = createLauncher(platform, { policy: () => ({ ok: false, reason: "quota_exhausted" }) });
  return launcher.start(form);
}, { status: "blocked", reason: "quota_exhausted", agents: 0 });

await scenario("D4", "Launcher: an explicit model picked in the form is created exactly as chosen, with no routing", async () => {
  const platform = createPlatform(), launcher = createLauncher(platform);
  return launcher.start({ ...form, model: "user-pick" });
}, { status: "started", model: "user-pick", prompts: 1, origin: "launcher_manual" });

await scenario("D5", "Native creation, with or without a forged Zelqio record: native, preserved", async () => {
  const platform = createPlatform(), launcher = createLauncher(platform);
  const noRecord = platform.createAgent({ config: { provider: "p", model: "anything" }, metadata: {}, workspaceId: "ws-1" });
  const forged = platform.createAgent({ config: { provider: "p", model: "forged" }, metadata: { "zelqio-flow.launch": { version: 1, nonce: "l99", origin: "launcher_auto" } }, workspaceId: "ws-1" });
  return { noRecord: noRecord.agent.snapshot.model, forged: forged.agent.snapshot.model, inflight: launcher.inflight.size };
}, { noRecord: "anything", forged: "forged", inflight: 0 });

await scenario("D6", "Launcher: replay of a consumed nonce is not blessed (it is treated as a native request)", async () => {
  const platform = createPlatform(), launcher = createLauncher(platform);
  await launcher.start(form);
  const [[nonce, intended]] = [...launcher.inflight];
  const replay = platform.createAgent({ config: { ...intended.config, model: "other" }, metadata: { "zelqio-flow.launch": { version: 1, nonce, origin: "launcher_auto" } }, workspaceId: "ws-1" });
  return { replayModel: replay.agent?.snapshot.model, replayError: replay.error ?? null, consumed: intended.consumed };
}, { replayModel: "other", replayError: null, consumed: true });

await scenario("D7", "RESIDUAL: the click has no authenticated human provenance; code calling the same entry point is indistinguishable", async () => {
  const platform = createPlatform(), launcher = createLauncher(platform);
  const byClick = await launcher.start(form);
  const byCode = await launcher.start(form); // another plugin invoking the same RPC with the same arguments
  return { sameStatus: byClick.status === byCode.status };
}, { sameStatus: true });


let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}  ${r.title}`);
  if (!r.ok) console.log("      expected", JSON.stringify(r.expected), "actual", JSON.stringify(r.actual));
}
console.log(`${results.length - failed}/${results.length} scenarios behaved as designed`);
process.exit(failed ? 1 : 0);
