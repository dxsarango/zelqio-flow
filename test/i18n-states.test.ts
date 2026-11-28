import { describe, expect, it } from "vitest";
import { resources } from "../client/resources";
import { maturityLevel } from "../shared/status";
import { providerStatus } from "../shared/providers";
import type { ResolutionNoteCode, Scope } from "../shared/scoped-settings";
import type { IssueCode } from "../shared/settings";
import type { UsageStatus } from "../shared/usage";

type Resource = { readonly [key: string]: string | Resource };

function flatten(resource: Resource, prefix = ""): Record<string, string> {
  return Object.entries(resource).reduce<Record<string, string>>((out, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? { ...out, [path]: value } : { ...out, ...flatten(value, path) };
  }, {});
}
const variables = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort();

// These records fail the typecheck when a state is added to its contract without being listed here.
const usageStatuses: Record<UsageStatus, true> = { fresh: true, stale: true, unknown: true, exhausted: true, reset: true };
const issueCodes: Record<IssueCode, true> = {
  no_provider: true, no_primary: true, provider_missing: true, provider_not_ready: true,
  provider_disabled: true, consumption_requires_opt_in: true, remote_denied: true, mode_effect_inactive: true,
};
const noteCodes: Record<ResolutionNoteCode, true> = { remote_denied_above: true, elevated_unconfirmed: true, session_elevation_blocked: true };
const scopes: Record<Scope, true> = { global: true, project: true, session: true };
const states: Record<string, readonly string[]> = {
  "prefs.scopes.notes": Object.keys(noteCodes),
  "prefs.scopes.source": Object.keys(scopes),
  "status.level": maturityLevel.options,
  "providers.status": providerStatus.options,
  "resources.status": Object.keys(usageStatuses),
  issues: Object.keys(issueCodes),
};

describe("product state translations", () => {
  const locales = Object.entries(resources).map(([locale, resource]) => [locale, flatten(resource)] as const);

  for (const [prefix, values] of Object.entries(states)) {
    for (const [locale, flat] of locales) {
      it(`${locale} names every ${prefix} state`, () => {
        for (const value of values) expect(flat[`${prefix}.${value}`]?.trim(), `${prefix}.${value}`).toBeTruthy();
      });
    }
  }

  it("translates the same state texts with the same variables in every locale", () => {
    const [, source] = locales[0];
    for (const [prefix, values] of Object.entries(states)) {
      for (const value of values) {
        for (const [locale, flat] of locales) {
          const key = `${prefix}.${value}`;
          expect(variables(flat[key] ?? ""), `${locale} ${key}`).toEqual(variables(source[key] ?? ""));
        }
      }
    }
  });

  it("provides complete plural forms with a count variable in every locale", () => {
    for (const [locale, flat] of locales) {
      const bases = new Set(Object.keys(flat).filter(key => /_(one|other)$/.test(key)).map(key => key.replace(/_(one|other)$/, "")));
      for (const base of bases) {
        expect(flat[`${base}_one`], `${locale} ${base}_one`).toBeTruthy();
        expect(flat[`${base}_other`], `${locale} ${base}_other`).toBeTruthy();
        expect(variables(flat[`${base}_one`]), `${locale} ${base}_one`).toContain("count");
        expect(variables(flat[`${base}_other`]), `${locale} ${base}_other`).toContain("count");
      }
    }
  });

  it("does not leave raw state identifiers as visible text", () => {
    for (const [locale, flat] of locales) {
      for (const [prefix, values] of Object.entries(states)) {
        for (const value of values) {
          expect(flat[`${prefix}.${value}`], `${locale} ${prefix}.${value}`).not.toBe(value);
        }
      }
    }
  });
});
