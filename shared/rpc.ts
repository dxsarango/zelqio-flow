import { defineRpc } from "@getpaseo/plugin";
import { z, type ZodType } from "zod";
import { errorShape, ZelqioError, type ErrorCode } from "./errors";

/** Every response is an envelope so failures are data, not transport errors. */
export function resultSchema<Data extends ZodType>(data: Data) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: errorShape }),
  ]);
}

/** Defines a Zelqio RPC. The name is prefixed with `zelqio.` and the output is the result envelope. */
export function defineZelqioRpc<Input extends ZodType, Data extends ZodType>(definition: {
  name: string;
  input: Input;
  data: Data;
}) {
  return defineRpc({
    name: `zelqio.${definition.name}`,
    input: definition.input,
    output: resultSchema(definition.data),
  });
}

/** Client helper: returns the data of a result envelope or throws the normalized `ZelqioError`. */
export function unwrapResult<Data>(
  result: { ok: true; data: Data } | { ok: false; error: { code: ErrorCode; message: string; retryable: boolean } },
): Data {
  if (result.ok) return result.data;
  throw new ZelqioError(result.error.code, result.error.message, { retryable: result.error.retryable });
}
