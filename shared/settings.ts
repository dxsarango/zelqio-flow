import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import type { ProviderCatalogData } from "./providers";

/**
 * Foundation settings record user preferences. Read-only advice can use them without treating them
 * as authority for routing effects, delegation or Git operations. Provider ids are opaque catalog IDs.
 */
export const PROVIDER_USES = ["primary", "auxiliary", "off"] as const;
export const FUNDINGS = ["subscription", "free", "local", "consumption"] as const;
export const STRATEGIES = ["balanced", "economy", "quality_first", "custom"] as const;
export const MODES = ["review_first", "auto_merge", "smart_review", "autopilot"] as const;
export const WORKFLOWS = ["local_only", "pull_request", "fork", "direct"] as const;
export const REMOTE_AUTHORIZATIONS = ["denied", "per_project"] as const;
/** Modes that act without a human gate; they need an explicit confirmation in the UI. */
export const ELEVATED_MODES = ["auto_merge", "autopilot"] as const;

export const providerUse = z.enum(PROVIDER_USES);
export const funding = z.enum(FUNDINGS);
export const strategy = z.enum(STRATEGIES);
export const workMode = z.enum(MODES);
export const gitWorkflow = z.enum(WORKFLOWS);
export const remoteAuthorization = z.enum(REMOTE_AUTHORIZATIONS);

export const providerSetting = z.strictObject({ use: providerUse, funding });

/**
 * Key of a project: the workspace directory as Paseo reports it, normalized by `normalizeProjectKey`
 * (separators, trailing slash and, for Windows paths, letter case). It is not the Git root: a Git root needs
 * file access and differs between a checkout and its worktrees, while the workspace directory is what a run
 * is submitted with.
 */
export const projectKey = z.string().min(1).max(400).refine((value) => !/[\u0000-\u001f]/.test(value), "invalid project key");

/**
 * Overrides of one project. Only these fields may differ from the global values. Consumption opt-in is not here on
 * purpose: it can never be granted below the global scope. Remote authorization may only tighten (see
 * `resolveSettings`). An elevated mode only counts once the project confirmed it explicitly.
 */
export const projectOverride = z.strictObject({
  strategy: strategy.optional(),
  mode: workMode.optional(),
  git: z.strictObject({ workflow: gitWorkflow.optional() }).optional(),
  remoteAuthorization: remoteAuthorization.optional(),
  elevatedConfirmed: z.boolean().default(false),
});
export type ProjectOverride = z.infer<typeof projectOverride>;

/** Overrides one run (session) is submitted with. A session may change the strategy and the mode, nothing else. */
export const sessionOverride = z.strictObject({ strategy: strategy.optional(), mode: workMode.optional() });
export type SessionOverride = z.infer<typeof sessionOverride>;

/**
 * How long finished runs stay in the plugin's own state directory. Prompts and results never leave the machine;
 * this only bounds how long they stay on it. `resultDays: 0` clears the result text as soon as the run is delivered.
 */
export const retentionPolicy = z.strictObject({
  finishedDays: z.int().min(1).max(3650).default(30),
  resultDays: z.int().min(0).max(3650).default(30),
  maxFinishedRuns: z.int().min(1).max(10_000).default(200),
});
export type RetentionPolicy = z.infer<typeof retentionPolicy>;
export const DEFAULT_RETENTION: RetentionPolicy = { finishedDays: 30, resultDays: 30, maxFinishedRuns: 200 };

export const zelqioSettings = z
  .strictObject({
    onboardingCompleted: z.boolean().default(false),
    providers: z.record(z.string(), providerSetting).default({}),
    /** Explicit, UI-confirmed opt-in. `consumption` funding is only valid while this is true. */
    consumptionOptIn: z.boolean().default(false),
    strategy: strategy.default("balanced"),
    mode: workMode.default("review_first"),
    git: z.strictObject({ workflow: gitWorkflow.default("local_only") }).default({ workflow: "local_only" }),
    /** Publication stays denied until the user configures it; per-project grants live in the policy layers. */
    remoteAuthorization: remoteAuthorization.default("denied"),
    /** Power Management: keep the computer awake only while work is in progress. Off until the user turns it on. */
    power: z.strictObject({ preventSleep: z.boolean().default(false) }).default({ preventSleep: false }),
    /** Per-project overrides of strategy, mode, workflow and remote authorization, keyed by `normalizeProjectKey`. */
    projects: z.record(projectKey, projectOverride).refine((all) => Object.keys(all).length <= 200, "too many projects").default({}),
    /** How long finished runs and their results stay on this machine. */
    retention: retentionPolicy.default({ ...DEFAULT_RETENTION }),
  })
  .refine((s) => s.consumptionOptIn || !Object.values(s.providers).some((p) => p.use !== "off" && p.funding === "consumption"), {
    message: "consumption funding requires the explicit consumption opt-in",
    path: ["consumptionOptIn"],
  });

export type ZelqioSettings = z.infer<typeof zelqioSettings>;
export type ProviderUse = z.infer<typeof providerUse>;
export type Funding = z.infer<typeof funding>;

export function defaultSettings(): ZelqioSettings {
  return {
    onboardingCompleted: false,
    providers: {},
    consumptionOptIn: false,
    strategy: "balanced",
    mode: "review_first",
    git: { workflow: "local_only" },
    remoteAuthorization: "denied",
    power: { preventSleep: false },
    projects: {},
    retention: { ...DEFAULT_RETENTION },
  };
}

/** Version 1 is the first stored shape, so there is nothing to convert yet; unknown shapes fall back to defaults. */
export function migrateSettings(values: unknown, fromVersion: number): unknown {
  if (fromVersion === 1 && typeof values === "object" && values !== null && !Array.isArray(values)) return values;
  return defaultSettings();
}

export const SETTINGS_ID = "general";

export const zelqioSettingsDefinition = defineSettings({
  id: SETTINGS_ID,
  scope: "host",
  version: 1,
  schema: zelqioSettings,
  migrate: migrateSettings,
});

export type IssueCode =
  | "no_provider"
  | "no_primary"
  | "provider_missing"
  | "provider_not_ready"
  | "provider_disabled"
  | "consumption_requires_opt_in"
  | "remote_denied"
  | "mode_effect_inactive";

export interface SettingsIssue {
  code: IssueCode;
  severity: "error" | "warning";
  /** Provider id for provider-scoped issues. */
  provider?: string;
}

export function isElevatedMode(mode: ZelqioSettings["mode"]): boolean {
  return (ELEVATED_MODES as readonly string[]).includes(mode);
}

/**
 * Validates settings against the live catalog. A provider that vanished or is not ready is flagged and left in
 * place: it is never replaced by another provider, and never by a paid (consumption) one.
 * Provider coverage is only required once onboarding is being completed.
 */
export function validateSettings(settings: ZelqioSettings, catalog: ProviderCatalogData): SettingsIssue[] {
  const issues: SettingsIssue[] = [];
  const selected = Object.entries(settings.providers).filter(([, p]) => p.use !== "off");
  const byId = new Map(catalog.providers.map((p) => [p.id, p]));

  for (const [id, p] of selected) {
    const entry = byId.get(id);
    if (!entry) issues.push({ code: "provider_missing", severity: "error", provider: id });
    else if (!entry.enabled) issues.push({ code: "provider_disabled", severity: "error", provider: id });
    else if (entry.status !== "ready") issues.push({ code: "provider_not_ready", severity: "error", provider: id });
    if (p.funding === "consumption" && !settings.consumptionOptIn) {
      issues.push({ code: "consumption_requires_opt_in", severity: "error", provider: id });
    }
  }
  if (settings.onboardingCompleted) {
    if (selected.length === 0) issues.push({ code: "no_provider", severity: "error" });
    else if (!selected.some(([, p]) => p.use === "primary")) issues.push({ code: "no_primary", severity: "error" });
  }

  const remoteWorkflow = settings.git.workflow !== "local_only";
  if (remoteWorkflow && settings.remoteAuthorization === "denied") issues.push({ code: "remote_denied", severity: "warning" });
  if (isElevatedMode(settings.mode) && (!remoteWorkflow || settings.remoteAuthorization === "denied")) {
    issues.push({ code: "mode_effect_inactive", severity: "warning" });
  }
  return issues;
}

/** Choices that need an explicit confirmation before they can be saved: elevated modes and consumption. */
export function elevatedChoices(settings: ZelqioSettings): Array<"auto_merge" | "autopilot" | "consumption"> {
  const out: Array<"auto_merge" | "autopilot" | "consumption"> = [];
  if (settings.mode === "auto_merge" || settings.mode === "autopilot") out.push(settings.mode);
  if (Object.values(settings.providers).some((p) => p.use !== "off" && p.funding === "consumption")) out.push("consumption");
  return out;
}

export interface SettingsSummary {
  providers: Array<{ id: string; label: string; use: Exclude<ProviderUse, "off">; funding: Funding; usable: boolean }>;
  strategy: ZelqioSettings["strategy"];
  mode: ZelqioSettings["mode"];
  workflow: ZelqioSettings["git"]["workflow"];
  remoteAuthorization: ZelqioSettings["remoteAuthorization"];
  elevated: ReturnType<typeof elevatedChoices>;
  /** Always false in Foundation: the summary describes intent, not active behaviour. */
  effectsActive: false;
  issues: SettingsIssue[];
}

export function buildSummary(settings: ZelqioSettings, catalog: ProviderCatalogData): SettingsSummary {
  const byId = new Map(catalog.providers.map((p) => [p.id, p]));
  return {
    providers: Object.entries(settings.providers)
      .filter(([, p]) => p.use !== "off")
      .map(([id, p]) => {
        const entry = byId.get(id);
        return {
          id,
          label: entry?.label ?? id,
          use: p.use as Exclude<ProviderUse, "off">,
          funding: p.funding,
          usable: entry !== undefined && entry.enabled && entry.status === "ready",
        };
      }),
    strategy: settings.strategy,
    mode: settings.mode,
    workflow: settings.git.workflow,
    remoteAuthorization: settings.remoteAuthorization,
    elevated: elevatedChoices(settings),
    effectsActive: false,
    issues: validateSettings(settings, catalog),
  };
}

export function hasErrors(issues: SettingsIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
