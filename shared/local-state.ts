import { z } from "zod";
import { defineZelqioRpc } from "./rpc";

const reference = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);

/** What the manual export may carry: an id, a verdict and a commit. Nothing else ever reaches it. */
export const exportResult = z.strictObject({
  version: z.literal(1),
  records: z.array(z.strictObject({
    id: reference,
    verdict: z.enum(["PASS", "FAIL", "BLOCKED", "NOT_RUN"]),
    sha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
  })),
  rejected: z.number().int().nonnegative(),
});

export const purgeResult = z.strictObject({
  removedRuns: z.number().int().nonnegative(),
  clearedResults: z.number().int().nonnegative(),
  removedAttempts: z.number().int().nonnegative(),
});
export type PurgeResult = z.infer<typeof purgeResult>;

export const deleteResult = z.strictObject({ deletedFiles: z.number().int().nonnegative() });

export const knownProject = z.strictObject({ key: z.string().min(1).max(400), name: z.string().max(200).nullable() });

/** Writes nothing: returns the allowlisted fields so the user can copy them. */
export const stateExportRpc = defineZelqioRpc({ name: "state.export", input: z.strictObject({}), data: exportResult });
/** Applies the retention policy now, with the same rules as the periodic purge. */
export const statePurgeRpc = defineZelqioRpc({ name: "state.purge", input: z.strictObject({}), data: purgeResult });
/** Deletes every run, attempt and Git journal file of the plugin. Refused while any run is active. */
export const stateDeleteRpc = defineZelqioRpc({ name: "state.delete", input: z.strictObject({ confirm: z.literal(true) }), data: deleteResult });
/** Workspaces the user can set overrides for: Paseo projects and the projects of earlier runs. */
export const projectsListRpc = defineZelqioRpc({ name: "projects.list", input: z.strictObject({}), data: z.strictObject({ projects: z.array(knownProject) }) });
