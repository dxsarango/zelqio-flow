import { z } from "zod";
import {
  MODES,
  gitWorkflow,
  isElevatedMode,
  remoteAuthorization,
  strategy,
  workMode,
  type ProjectOverride,
  type SessionOverride,
  type ZelqioSettings,
} from "./settings";

/**
 * Settings live at three scopes: global, per project and per session (one run). The most specific scope wins, except
 * for safety limits, which only ever tighten:
 *  - remote authorization `denied` at any scope wins, so a lower scope can never grant publication a higher one denies;
 *  - the consumption opt-in is global only, so no override can grant it;
 *  - an elevated mode (auto_merge, autopilot) set for a project needs that project's explicit confirmation, and a
 *    session can never be more elevated than its project.
 */
export type Scope = "global" | "project" | "session";
export const SCOPES: readonly Scope[] = ["global", "project", "session"];

export const effectiveValues = z.strictObject({
  strategy,
  mode: workMode,
  workflow: gitWorkflow,
  remoteAuthorization,
});
/** The values a run uses, recorded when it starts. */
export type EffectiveValues = z.infer<typeof effectiveValues>;

export type ResolvedField = keyof EffectiveValues;
export type ResolutionNoteCode =
  /** A project asked for remote publication that the global setting denies; it stays denied. */
  | "remote_denied_above"
  /** The project chose an elevated mode without confirming it; the lower mode stays. */
  | "elevated_unconfirmed"
  /** The session asked for a mode more elevated than its project allows; the project mode stays. */
  | "session_elevation_blocked";
export interface ResolutionNote { field: ResolvedField; code: ResolutionNoteCode; }

export interface Resolution {
  values: EffectiveValues & { consumptionOptIn: boolean };
  /** Where each effective value comes from. For a limit that tightened a request, the scope that imposed it. */
  sources: Record<ResolvedField, Scope>;
  notes: ResolutionNote[];
}

/**
 * Canonical key of a project: the workspace directory as Paseo reports it. Backslashes become slashes, repeated and
 * trailing slashes go, and a Windows path (drive letter or UNC) is lowercased because that file system ignores case.
 * It does not touch the file system, so the same directory always gives the same key.
 */
export function normalizeProjectKey(directory: string): string {
  let path = directory.trim().replace(/^[\\/]{2}\?[\\/]/, "").replace(/\\/g, "/");
  const windows = /^[A-Za-z]:/.test(path) || path.startsWith("//");
  path = path.replace(/(?!^\/\/)\/{2,}/g, "/");
  if (path.length > 1 && !/^[A-Za-z]:\/$/.test(path)) path = path.replace(/\/+$/, "");
  if (/^[A-Za-z]:$/.test(path)) path += "/";
  return windows ? path.toLowerCase() : path;
}

const rank = (mode: ZelqioSettings["mode"]) => MODES.indexOf(mode);

/**
 * Looks the project up by its normalized key. A directory inside a project belongs to it; when projects are nested the
 * longest key wins. A key stored in another spelling still matches.
 */
function projectOf(global: ZelqioSettings, directory: string | undefined) {
  if (!directory) return undefined;
  const key = normalizeProjectKey(directory);
  let best: { length: number; value: ProjectOverride } | undefined;
  for (const [stored, value] of Object.entries(global.projects)) {
    const root = normalizeProjectKey(stored);
    const inside = key === root || key.startsWith(root.endsWith("/") ? root : root + "/");
    if (inside && (!best || root.length > best.length)) best = { length: root.length, value };
  }
  return best?.value;
}

/** Pure: session > project > global, with the safety limits above. Never reads files or the clock. */
export function resolveSettings(
  global: ZelqioSettings,
  scope: { project?: string; session?: SessionOverride } = {},
): Resolution {
  const project = projectOf(global, scope.project);
  const session = scope.session ?? {};
  const notes: ResolutionNote[] = [];
  const sources: Resolution["sources"] = { strategy: "global", mode: "global", workflow: "global", remoteAuthorization: "global" };

  let chosenStrategy = global.strategy;
  if (project?.strategy) { chosenStrategy = project.strategy; sources.strategy = "project"; }
  if (session.strategy) { chosenStrategy = session.strategy; sources.strategy = "session"; }

  let mode = global.mode;
  if (project?.mode) {
    if (isElevatedMode(project.mode) && !project.elevatedConfirmed) notes.push({ field: "mode", code: "elevated_unconfirmed" });
    else { mode = project.mode; sources.mode = "project"; }
  }
  if (session.mode) {
    if (isElevatedMode(session.mode) && rank(session.mode) > rank(mode)) notes.push({ field: "mode", code: "session_elevation_blocked" });
    else { mode = session.mode; sources.mode = "session"; }
  }

  const workflow = project?.git?.workflow ?? global.git.workflow;
  if (project?.git?.workflow) sources.workflow = "project";

  let remote: ZelqioSettings["remoteAuthorization"] = "per_project";
  if (global.remoteAuthorization === "denied") {
    remote = "denied";
    if (project?.remoteAuthorization === "per_project") notes.push({ field: "remoteAuthorization", code: "remote_denied_above" });
  } else if (project?.remoteAuthorization === "denied") {
    remote = "denied";
    sources.remoteAuthorization = "project";
  } else if (project?.remoteAuthorization === "per_project") {
    sources.remoteAuthorization = "project";
  }

  return {
    values: { strategy: chosenStrategy, mode, workflow, remoteAuthorization: remote, consumptionOptIn: global.consumptionOptIn },
    sources,
    notes,
  };
}

/** What a run needs to know about itself to be resolved. `cwd` is used when no project key was recorded. */
export interface ScopedRun {
  cwd: string;
  projectKey?: string;
  overrides?: SessionOverride;
}

/** The global settings with the strategy, mode, workflow and remote authorization this run resolves to. */
export function settingsForRun(global: ZelqioSettings, run: ScopedRun): ZelqioSettings {
  return withResolution(global, resolveSettings(global, { project: run.projectKey ?? run.cwd, session: run.overrides }));
}

/** Same for a creation request that has only a directory and no session overrides. */
export function settingsForDirectory(global: ZelqioSettings, directory: string): ZelqioSettings {
  return withResolution(global, resolveSettings(global, { project: directory }));
}

export function withResolution(global: ZelqioSettings, resolution: Resolution): ZelqioSettings {
  const { strategy: chosen, mode, workflow, remoteAuthorization: remote } = resolution.values;
  return { ...global, strategy: chosen, mode, git: { workflow }, remoteAuthorization: remote };
}

export function recordedValues(resolution: Resolution): EffectiveValues {
  const { strategy: chosen, mode, workflow, remoteAuthorization: remote } = resolution.values;
  return { strategy: chosen, mode, workflow, remoteAuthorization: remote };
}
