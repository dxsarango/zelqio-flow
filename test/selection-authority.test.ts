import { describe, expect, it, vi } from "vitest";
import type { FundingAdapter, FundingObservation } from "../server/funding-verification";
import { evaluateSelection, selectionInvalidation } from "../server/selection-authority";
import type { SelectionProposal, SelectionSnapshot } from "../shared/selection-authority";

const route = { host: "host", project: "project", provider: "fixture", model: "recommended", binding: "account-a" };
const effective = {
  options: { reasoning: "low", extra: { enabled: true, labels: ["fixture"] } },
  mode: "review",
  permissions: { tools: { allow: ["read"], deny: ["write"] } },
};
const grant = { action: "select_model", route, policyRevision: "r2", funding: "subscription", expiresAt: 300 } as const;
const snapshot = {
  route, policyRevision: "r2", workspace: "workspace-a", destination: "draft-a", grant,
  intent: "automatic",
  nativeChoice: { provenance: "default", provider: route.provider, model: "native-default", effective },
  candidate: { provider: route.provider, model: route.model, declaredFunding: "subscription", effective, availability: "available" },
} satisfies SelectionSnapshot;
const observation: FundingObservation = {
  route,
  funding: "subscription",
  source: "observed",
  evidenceRef: "fixture-observation",
  additionalCharges: "blocked",
  observedAt: 150,
  expiresAt: 400,
};
const clock = () => 200;

function adapter(result: FundingObservation | null = observation) {
  const observe = vi.fn<FundingAdapter["observe"]>().mockResolvedValue(result);
  const adapters = new Map([[result?.route.provider ?? route.provider, { observe, maxObservationAgeMs: 100, timeoutMs: 100 }]]);
  return { adapters, observe };
}

function evaluate(input: SelectionSnapshot, result: FundingObservation | null = observation) {
  return evaluateSelection(adapter(result).adapters, input, () => input, clock);
}

describe("native draft selection authority", () => {
  it.each([
    ["explicit", "keep_user_choice", "explicit_choice"],
    ["unknown", "blocked", "unknown_choice"],
  ] as const)("preserves the native model when provenance is %s", async (provenance, status, reason) => {
    const { adapters, observe } = adapter();
    const input = { ...snapshot, nativeChoice: { ...snapshot.nativeChoice, provenance } };
    expect(await evaluateSelection(adapters, input, () => input, clock)).toEqual({ status, reason, validUntil: null });
    expect(observe).not.toHaveBeenCalled();
  });

  it("requires intent in addition to a native default, a grant and verified funding", async () => {
    const { adapters, observe } = adapter();
    const disabled = { ...snapshot, intent: "disabled" } as const;
    const markerOnly = { ...snapshot, grant: undefined };
    expect(await evaluateSelection(adapters, disabled, () => disabled, clock)).toMatchObject({
      status: "keep_user_choice", reason: "automatic_disabled",
    });
    expect(await evaluateSelection(adapters, markerOnly, () => markerOnly, clock)).toMatchObject({
      status: "blocked", reason: "policy_missing",
    });
    expect(observe).not.toHaveBeenCalled();
  });

  it("approves an exact candidate for a native default with verified no-extra-cost funding", async () => {
    const { adapters, observe } = adapter();
    const input = {
      ...snapshot,
      candidate: {
        ...snapshot.candidate,
        effective: {
          ...effective,
          options: { extra: { labels: ["fixture"], enabled: true }, reasoning: "low" },
        },
      },
    };
    expect(await evaluateSelection(adapters, input, () => input, clock)).toEqual({
      status: "apply_candidate", snapshot: input, verifiedFunding: "subscription", evidenceRef: "fixture-observation",
      checkedAt: 200, validUntil: 250,
    });
    expect(observe).toHaveBeenCalledExactlyOnceWith(route, expect.any(AbortSignal));
  });

  it.each([
    { expiresAt: 200 },
    { policyRevision: "r1" },
    { route: { ...route, model: "different-model" } },
    { route: { ...route, model: route.model.toUpperCase() } },
    { route: { ...route, binding: "account-b" } },
    { route: { ...route, host: "other-host" } },
    { route: { ...route, project: "other-project" } },
    { route: { ...route, provider: "other-provider" } },
  ])("rejects a grant that differs from the current route or policy (%j)", async (change) => {
    const { adapters, observe } = adapter();
    const input = { ...snapshot, grant: { ...grant, ...change } };
    expect(await evaluateSelection(adapters, input, () => input, clock)).toMatchObject({
      status: "blocked", reason: "policy_missing",
    });
    expect(observe).not.toHaveBeenCalled();
  });

  it("rejects recommendations that do not identify the exact route", async () => {
    const input = { ...snapshot, candidate: { ...snapshot.candidate, model: "different-model" } };
    expect(await evaluate(input)).toMatchObject({ status: "blocked", reason: "candidate_route_mismatch" });
  });

  it("keeps the native choice when the candidate is already selected", async () => {
    const { adapters, observe } = adapter();
    const input = { ...snapshot, nativeChoice: { ...snapshot.nativeChoice, model: route.model } };
    expect(await evaluateSelection(adapters, input, () => input, clock)).toEqual({
      status: "keep_user_choice", reason: "candidate_matches_choice", validUntil: null,
    });
    expect(observe).not.toHaveBeenCalled();
  });

  it("rejects malformed evidence and a grant for an unrelated action", async () => {
    const { adapters, observe } = adapter();
    for (const input of [
      { ...snapshot, grant: { ...grant, action: "create_session" } },
      { ...snapshot, route: { ...route, binding: " " } },
      { ...snapshot, nativeChoice: { ...snapshot.nativeChoice, extraAuthority: true } },
      { ...snapshot, nativeChoice: { ...snapshot.nativeChoice, effective: { ...effective, permissions: undefined } } },
      { ...snapshot, candidate: { ...snapshot.candidate, effective: { ...effective, options: { secretHandle: () => 0 } } } },
      { ...snapshot, candidate: { ...snapshot.candidate, effective: { ...effective, options: JSON.parse('{"__proto__":true}') } } },
    ]) {
      expect(await evaluateSelection(adapters, input, () => snapshot, clock)).toMatchObject({
        status: "blocked", reason: "invalid_snapshot",
      });
    }
    expect(observe).not.toHaveBeenCalled();
  });

  it.each([
    { options: { ...effective.options, reasoning: "high" } },
    { mode: null },
    { permissions: { tools: { allow: ["read", "write"], deny: [] } } },
  ])("blocks a model change that would change effective settings (%j)", async (change) => {
    const input = { ...snapshot, candidate: { ...snapshot.candidate, effective: { ...effective, ...change } } };
    expect(await evaluate(input)).toMatchObject({ status: "blocked", reason: "effective_settings_changed" });
  });

  it.each([
    ["unavailable", "candidate_unavailable"],
    ["quota_exhausted", "quota_exhausted"],
    ["quota_reset_unconfirmed", "quota_reset_unconfirmed"],
    ["unknown", "availability_unknown"],
  ] as const)("blocks a route whose availability is %s", async (availability, reason) => {
    const input = { ...snapshot, candidate: { ...snapshot.candidate, availability } };
    expect(await evaluate(input)).toMatchObject({ status: "blocked", reason });
  });

  it.each([
    [null, "funding_unverified"],
    [{ ...observation, observedAt: 100 }, "funding_unverified"],
    [{ ...observation, expiresAt: 200 }, "funding_unverified"],
    [{ ...observation, route: { ...route, binding: "wrong-account" } }, "funding_unverified"],
    [{ ...observation, additionalCharges: "possible" }, "additional_charges_unverified"],
    [{ ...observation, additionalCharges: "unknown" }, "additional_charges_unverified"],
    [{ ...observation, funding: "consumption" }, "funding_mismatch"],
  ] as const)("blocks unverifiable funding or overage (%j)", async (result, reason) => {
    expect(await evaluate(snapshot, result)).toMatchObject({ status: "blocked", reason });
  });

  it.each([
    [{ ...snapshot, grant: { ...grant, funding: "consumption" } }, "consumption_excluded"],
    [{ ...snapshot, candidate: { ...snapshot.candidate, declaredFunding: "consumption" } }, "consumption_excluded"],
    [{ ...snapshot, candidate: { ...snapshot.candidate, declaredFunding: null } }, "funding_unverified"],
  ] as const)("blocks consumption policies or excluded declarations (%j)", async (input, reason) => {
    expect(await evaluate(input)).toMatchObject({ status: "blocked", reason });
  });

  it.each([
    { policyRevision: "r3" },
    { destination: "draft-b" },
    { workspace: "workspace-b" },
    { route: { ...route, binding: "account-b" } },
  ])("blocks scope changes both before and during provider verification (%j)", async (change) => {
    const { adapters, observe } = adapter();
    let current = { ...snapshot, ...change };
    expect(await evaluateSelection(adapters, snapshot, () => current, clock)).toMatchObject({
      status: "blocked", reason: "scope_changed",
    });
    expect(observe).not.toHaveBeenCalled();

    current = snapshot;
    observe.mockImplementationOnce(async () => {
      current = { ...snapshot, ...change };
      return observation;
    });
    expect(await evaluateSelection(adapters, snapshot, () => current, clock)).toMatchObject({
      status: "blocked", reason: "scope_changed",
    });
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it.each([
    { nativeChoice: { ...snapshot.nativeChoice, provenance: "explicit" } },
    { candidate: { ...snapshot.candidate, effective: { ...effective, mode: "execute" } } },
    { grant: undefined },
  ] satisfies Partial<SelectionSnapshot>[])("blocks changed selection evidence during observation (%j)", async (change) => {
    const { adapters, observe } = adapter();
    let current: SelectionSnapshot = snapshot;
    observe.mockImplementationOnce(async () => {
      current = { ...snapshot, ...change };
      return observation;
    });
    expect(await evaluateSelection(adapters, snapshot, () => current, clock)).toMatchObject({
      status: "blocked", reason: "selection_changed",
    });
  });

  it("fails closed when the current scope cannot be resolved", async () => {
    const { adapters, observe } = adapter();
    const currentScope = () => { throw new Error("draft disappeared"); };
    expect(await evaluateSelection(adapters, snapshot, currentScope, clock)).toMatchObject({
      status: "blocked", reason: "scope_changed",
    });
    expect(observe).not.toHaveBeenCalled();
  });

  it("rejects an observation whose verification has expired by the time the decision is returned", async () => {
    const tickingClock = vi.fn().mockReturnValueOnce(200).mockReturnValueOnce(249).mockReturnValue(250);
    expect(await evaluateSelection(adapter().adapters, snapshot, () => snapshot, tickingClock)).toMatchObject({
      status: "blocked", reason: "verification_expired",
    });
  });

  it.each([1, 2, 3])("blocks when clock read %i throws", async (failedRead) => {
    let reads = 0;
    const failingClock = () => {
      if (++reads === failedRead) throw new Error("clock unavailable");
      return 200;
    };
    await expect(evaluateSelection(adapter().adapters, snapshot, () => snapshot, failingClock)).resolves.toEqual({
      status: "blocked", reason: "invalid_clock", validUntil: null,
    });
  });

  it.each([
    [200, 199, 210],
    [200, 210, 209],
  ])("blocks clock rollback at readings %i, %i, %i", async (start, assessedAt, finalRead) => {
    const tickingClock = vi.fn().mockReturnValueOnce(start).mockReturnValueOnce(assessedAt).mockReturnValue(finalRead);
    await expect(evaluateSelection(adapter().adapters, snapshot, () => snapshot, tickingClock)).resolves.toEqual({
      status: "blocked", reason: "invalid_clock", validUntil: null,
    });
  });

  it("issues a proposal with a timestamp at least as recent as the funding assessment", async () => {
    const tickingClock = vi.fn().mockReturnValueOnce(200).mockReturnValueOnce(210).mockReturnValue(220);
    expect(await evaluateSelection(adapter().adapters, snapshot, () => snapshot, tickingClock)).toMatchObject({
      status: "apply_candidate", checkedAt: 220, validUntil: 250,
    });
  });

  it("rejects a hand-written proposal before any funding verification has run", () => {
    const forged = Object.freeze({
      status: "apply_candidate", snapshot, verifiedFunding: "subscription", evidenceRef: "forged", checkedAt: 200, validUntil: 250,
    } satisfies SelectionProposal);
    expect(selectionInvalidation(forged, snapshot, clock)).toBe("proposal_not_issued");
  });

  it("rejects copies and proposals restored from JSON while retaining the genuine proposal's expiry", async () => {
    const decision = await evaluate(snapshot);
    if (decision.status !== "apply_candidate") throw new Error("fixture did not authorize a selection");
    expect(selectionInvalidation(Object.freeze({ ...decision }), snapshot, clock)).toBe("proposal_not_issued");
    expect(selectionInvalidation(JSON.parse(JSON.stringify(decision)), snapshot, clock)).toBe("proposal_not_issued");
    expect(selectionInvalidation(decision, snapshot, clock)).toBeNull();
    expect(selectionInvalidation(decision, snapshot, () => decision.validUntil)).toBe("verification_expired");
  });

  it("requires reevaluation at the expiry boundary or after the live snapshot changes", async () => {
    const decision = await evaluate(snapshot);
    if (decision.status !== "apply_candidate") throw new Error("fixture did not authorize a selection");
    expect(selectionInvalidation(decision, snapshot, () => 249)).toBeNull();
    expect(selectionInvalidation(decision, snapshot, () => decision.validUntil)).toBe("verification_expired");
    expect(selectionInvalidation(decision, snapshot, () => decision.validUntil + 1)).toBe("verification_expired");
    expect(selectionInvalidation(decision, snapshot, () => decision.checkedAt - 1)).toBe("verification_expired");
    expect(selectionInvalidation(decision, snapshot, () => { throw new Error("clock unavailable"); })).toBe("invalid_clock");
    for (const change of [
      { policyRevision: "r3" }, { destination: "draft-b" }, { workspace: "workspace-b" },
      { route: { ...route, binding: "account-b" } },
    ]) {
      expect(selectionInvalidation(decision, { ...snapshot, ...change }, clock)).toBe("scope_changed");
    }
    expect(selectionInvalidation(decision, { ...snapshot, grant: undefined }, clock)).toBe("selection_changed");
    expect(selectionInvalidation(decision, {
      ...snapshot, nativeChoice: { ...snapshot.nativeChoice, provenance: "explicit" },
    }, clock)).toBe("selection_changed");
  });

  it("keeps the verified evidence immutable and independent of later edits to the input", async () => {
    const input = structuredClone(snapshot);
    const decision = await evaluate(input);
    if (decision.status !== "apply_candidate") throw new Error("fixture did not authorize a selection");
    input.candidate.effective.permissions.tools.allow.push("write");
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.snapshot.candidate.effective.permissions.tools)).toBe(true);
    expect(decision.snapshot.candidate.effective.permissions).toEqual({ tools: { allow: ["read"], deny: ["write"] } });
    expect(selectionInvalidation(decision, input, clock)).toBe("selection_changed");
  });

  it("blocks both a never-settling adapter and a late observation", async () => {
    vi.useFakeTimers();
    try {
      const { adapters, observe } = adapter();
      let resolveLate!: (value: FundingObservation) => void;
      observe.mockImplementationOnce(() => new Promise(() => {}));
      observe.mockImplementationOnce(() => new Promise(resolve => { resolveLate = resolve; }));
      const currentScope = vi.fn(() => snapshot);
      const pending = evaluateSelection(adapters, snapshot, currentScope, clock);
      const late = evaluateSelection(adapters, snapshot, currentScope, clock);
      await vi.advanceTimersByTimeAsync(100);
      const expected = { status: "blocked", reason: "funding_unverified", validUntil: null };
      expect(await pending).toEqual(expected);
      expect(await late).toEqual(expected);
      expect(observe.mock.calls.map(([, signal]) => signal.aborted)).toEqual([true, true]);
      resolveLate(observation);
      await vi.advanceTimersByTimeAsync(0);
      expect(currentScope).toHaveBeenCalledTimes(4);
      expect(await late).toEqual(expected);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("draft selection fallback", () => {
  const retry = {
    attempt: 1,
    failedRoute: { ...route, model: "previous" },
    cause: "model_quota_exhausted",
    originalFunding: "subscription",
  } as const;

  it.each(["unavailable", "model_quota_exhausted"] as const)("allows a separately authorized same-provider alternative after %s", async (cause) => {
    expect(await evaluate({ ...snapshot, retry: { ...retry, cause } })).toMatchObject({
      status: "apply_candidate", verifiedFunding: retry.originalFunding,
    });
  });

  it("requires an independent grant even when quota has recovered", async () => {
    expect(await evaluate({ ...snapshot, retry, grant: undefined })).toMatchObject({
      status: "blocked", reason: "policy_missing",
    });
    expect(await evaluate({ ...snapshot, retry, grant: { ...grant, route: retry.failedRoute } })).toMatchObject({
      status: "blocked", reason: "policy_missing",
    });
  });

  it("excludes the failed model and provider-wide exhaustion", async () => {
    for (const failure of [{ ...retry, failedRoute: route }, { ...retry, cause: "provider_quota_exhausted" } as const]) {
      expect(await evaluate({ ...snapshot, retry: failure })).toMatchObject({ status: "blocked", reason: "retry_target_excluded" });
    }
  });

  it("rejects fallback across account or endpoint bindings within the same provider", async () => {
    const { adapters, observe } = adapter();
    const input = { ...snapshot, retry: { ...retry, failedRoute: { ...retry.failedRoute, binding: "account-b" } } };
    expect(await evaluateSelection(adapters, input, () => input, clock)).toMatchObject({
      status: "blocked", reason: "scope_changed",
    });
    expect(observe).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, 2])("rejects fallback with attempt %s", async (attempt) => {
    const { adapters, observe } = adapter();
    const input = { ...snapshot, retry: { ...retry, attempt } };
    expect(await evaluateSelection(adapters, input, () => snapshot, clock)).toMatchObject({
      status: "blocked", reason: "invalid_snapshot",
    });
    expect(observe).not.toHaveBeenCalled();
  });

  it("enforces the same-provider rule even with independent evidence and a valid grant", async () => {
    const alternative = { ...route, provider: "alternative" };
    const input = {
      ...snapshot,
      route: alternative,
      candidate: { ...snapshot.candidate, provider: alternative.provider },
      grant: { ...grant, route: alternative },
    };
    const result = { ...observation, route: alternative };
    expect(await evaluate(input, result)).toMatchObject({ status: "blocked", reason: "different_provider" });
    expect(await evaluate({
      ...input, nativeChoice: { ...snapshot.nativeChoice, provider: alternative.provider }, retry,
    }, result)).toMatchObject({ status: "blocked", reason: "different_provider" });
  });

  it("preserves original verified funding and excludes consumption regardless of apparent quota", async () => {
    const input = { ...snapshot, retry };
    expect(await evaluate({
      ...input, grant: { ...grant, funding: "free" }, candidate: { ...snapshot.candidate, declaredFunding: "free" },
    }, { ...observation, funding: "free" })).toMatchObject({ status: "blocked", reason: "retry_funding_changed" });
    expect(await evaluate({ ...input, grant: { ...grant, funding: "consumption" } })).toMatchObject({
      status: "blocked", reason: "consumption_excluded",
    });
    expect(await evaluate({ ...input, retry: { ...retry, originalFunding: "consumption" } })).toMatchObject({
      status: "blocked", reason: "consumption_excluded",
    });
    expect(await evaluate(input, { ...observation, funding: "consumption" })).toMatchObject({
      status: "blocked", reason: "funding_mismatch",
    });
  });
});
