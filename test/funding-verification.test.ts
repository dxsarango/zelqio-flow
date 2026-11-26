import { describe, expect, it, vi } from "vitest";
import { assessFunding, type FundingAdapter, type FundingObservation } from "../server/funding-verification";

const route = { host: "host", project: "repo", provider: "fixture", model: "model", binding: "route-a" };
const grant = { route, policyRevision: "r2", funding: "subscription", expiresAt: 500 } as const;
const scope = { route, policyRevision: "r2" };
const request = { ...scope, grant, declaredFunding: "free", currentScope: () => scope } as const;
const observation: FundingObservation = {
  route,
  funding: "subscription",
  source: "observed",
  evidenceRef: "fixture-account-observation",
  additionalCharges: "blocked",
  observedAt: 150,
  expiresAt: 400,
};

function adapter(result: FundingObservation | null = observation) {
  const observe = vi.fn<FundingAdapter["observe"]>().mockResolvedValue(result);
  return { observe, adapters: new Map([[route.provider, { observe, maxObservationAgeMs: 100, timeoutMs: 100 }]]) };
}

describe("provider funding verification without additional charges", () => {
  it("applies existing exact-scope authorization and preserves the independent declaration", async () => {
    const { adapters, observe } = adapter();
    expect(await assessFunding(adapters, request, () => 200)).toEqual({
      declaredFunding: "free", authorizedFunding: "subscription", verifiedFunding: "subscription", declarationMatchesVerified: false,
      reason: "verified_no_additional_charges", verification: { ...scope, validUntil: 250, evidenceRef: observation.evidenceRef },
    });
    expect(observe).toHaveBeenCalledWith(route, expect.any(AbortSignal));
  });

  it("rejects absent, expired, superseded and consumption grants before provider reads", async () => {
    const { adapters, observe } = adapter();
    for (const [grant, reason] of [
      [undefined, "policy_missing"],
      [{ ...request.grant, expiresAt: 200 }, "policy_missing"],
      [{ ...request.grant, policyRevision: "revoked" }, "policy_missing"],
      [{ ...request.grant, funding: "consumption" }, "consumption_excluded"],
    ] as const) {
      expect(await assessFunding(adapters, { ...request, grant }, () => 200)).toMatchObject({ reason, verifiedFunding: null });
    }
    expect(observe).not.toHaveBeenCalled();
  });

  it("requires the exact model and the effective billing binding even on the same provider", async () => {
    for (const change of [{ binding: "route-b" }, { model: "model-free" }, { host: "other" }, { project: "other" }, { provider: "other" }]) {
      const { adapters, observe } = adapter({ ...observation, route: { ...route, ...change } });
      expect(await assessFunding(adapters, request, () => 200)).toMatchObject({ reason: "funding_unverified", verifiedFunding: null });
      expect(await assessFunding(adapters, { ...request, route: { ...route, ...change } }, () => 200)).toMatchObject({ reason: "policy_missing" });
      expect(observe).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps partial declarations and stale evidence out of the no-extra-charge path", async () => {
    for (const result of [
      null, { ...observation, observedAt: 201 }, { ...observation, expiresAt: 200 },
      { ...observation, observedAt: 100 }, { ...observation, expiresAt: Infinity },
      { ...observation, observedAt: NaN }, { ...observation, source: "attested" as const },
      { ...observation, evidenceRef: "" }, { ...observation, evidenceRef: "C:/private/path" },
    ]) {
      expect(await assessFunding(adapter(result).adapters, request, () => 200)).toMatchObject({
        reason: "funding_unverified", declaredFunding: "free", verifiedFunding: null,
      });
    }
    const { adapters, observe } = adapter();
    observe.mockRejectedValue(new Error("unavailable"));
    expect(await assessFunding(adapters, request, () => 200)).toMatchObject({ reason: "funding_unverified" });
    expect(await assessFunding(new Map(), request, () => 200)).toMatchObject({ reason: "funding_unverified" });
  });

  it("excludes a verified change in funding and uncertain or possible overage", async () => {
    const paid = adapter({ ...observation, funding: "consumption" });
    expect(await assessFunding(paid.adapters, request, () => 200)).toMatchObject({ reason: "funding_mismatch", verifiedFunding: "consumption" });
    for (const additionalCharges of ["possible", "unknown"] as const) {
      expect(await assessFunding(adapter({ ...observation, additionalCharges }).adapters, request, () => 200)).toMatchObject({
        reason: "additional_charges_unverified",
      });
    }
  });

  it("rechecks policy expiry after a provider read", async () => {
    const { adapters } = adapter();
    const clock = vi.fn().mockReturnValueOnce(200).mockReturnValueOnce(500);
    expect(await assessFunding(adapters, request, clock)).toMatchObject({ reason: "policy_missing", authorizedFunding: null });
  });

  it("rejects a policy revision or effective route changed during verification", async () => {
    const { adapters } = adapter();
    for (const current of [null, { ...scope, policyRevision: "r3" }, { ...scope, route: { ...route, binding: "changed" } }]) {
      expect(await assessFunding(adapters, { ...request, currentScope: () => current }, () => 200)).toMatchObject({
        reason: "scope_changed", authorizedFunding: null, verifiedFunding: null,
      });
    }
  });

  it("rejects malformed model routes and funding values after provider normalization", async () => {
    for (const invalid of [undefined, "wrong", "Consumption"]) {
      const funding = invalid as unknown as FundingObservation["funding"];
      const { adapters, observe } = adapter({ ...observation, funding });
      expect(await assessFunding(adapters, { ...request, grant: { ...grant, funding } }, () => 200)).toMatchObject({ reason: "policy_missing" });
      expect(observe).not.toHaveBeenCalled();
      expect(await assessFunding(adapters, request, () => 200)).toMatchObject({ reason: "funding_unverified" });
    }
    const blankRoute = { ...route, binding: " " };
    const { adapters } = adapter();
    expect(await assessFunding(adapters, {
      ...request, route: blankRoute, grant: { ...grant, route: blankRoute },
    }, () => 200)).toMatchObject({ reason: "policy_missing" });
  });

  it("bounds a provider that never settles and prevents its late result from authorizing funding", async () => {
    vi.useFakeTimers();
    try {
      const { adapters, observe } = adapter();
      let finish!: (value: FundingObservation) => void;
      observe.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
      const currentScope = vi.fn(() => scope);
      const pending = assessFunding(adapters, { ...request, currentScope }, () => 200);
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toMatchObject({ reason: "funding_unverified", verifiedFunding: null });
      expect(observe.mock.calls[0][1].aborted).toBe(true);
      finish(observation);
      await vi.advanceTimersByTimeAsync(0);
      expect(currentScope).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("binds expiry to the earliest policy, observation, or freshness deadline", async () => {
    const expiresSoon = adapter({ ...observation, expiresAt: 230 });
    expect(await assessFunding(expiresSoon.adapters, request, () => 200)).toMatchObject({ verification: { validUntil: 230 } });
    expect(await assessFunding(expiresSoon.adapters, { ...request, grant: { ...grant, expiresAt: 220 } }, () => 200))
      .toMatchObject({ verification: { validUntil: 220 } });
    expect(await assessFunding(expiresSoon.adapters, request, () => 230)).toMatchObject({ reason: "funding_unverified" });
  });
});
