import { z } from "zod";

/** Normalized error codes shared by every Zelqio RPC. */
export const errorCode = z.enum([
  "invalid_input", // the request failed contract validation
  "not_found", // the referenced entity does not exist
  "disabled", // the capability is disabled by maturity level, platform or missing evidence
  "unavailable", // a dependency (Paseo, Git, provider) could not be reached or answered
  "internal", // unexpected failure; the message is generic and carries no internals
]);
export type ErrorCode = z.infer<typeof errorCode>;

export const errorShape = z.object({
  code: errorCode,
  message: z.string(),
  retryable: z.boolean(),
});
export type ErrorShape = z.infer<typeof errorShape>;

/** Throw this from a handler to return a normalized, user-presentable failure. */
export class ZelqioError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  constructor(code: ErrorCode, message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "ZelqioError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

/**
 * Maps any thrown value to the normalized shape. Only `ZelqioError` and validation failures expose their
 * message; anything else becomes a generic `internal` error so paths, stacks and secrets never cross the wire.
 */
export function normalizeError(error: unknown): ErrorShape {
  if (error instanceof ZelqioError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof z.ZodError) {
    return { code: "invalid_input", message: "The request is not valid.", retryable: false };
  }
  return { code: "internal", message: "An unexpected error occurred.", retryable: false };
}
