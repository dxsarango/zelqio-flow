import type { PluginRpcContract } from "@getpaseo/plugin";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import type { input as ZodInput, output as ZodOutput } from "zod";
import { normalizeError } from "../shared/errors";

type Data<Contract extends PluginRpcContract> =
  Extract<ZodInput<Contract["output"]>, { ok: true }> extends { data: infer D } ? D : never;

/**
 * Registers a Zelqio RPC. The handler returns plain data or throws; this wrapper turns both into the result
 * envelope, so no handler can leak a stack, a path or a raw exception to the client.
 */
export function handleZelqio<Contract extends PluginRpcContract>(
  server: Pick<PluginServerContext, "handle">,
  contract: Contract,
  handler: (input: ZodOutput<Contract["input"]>, context: PluginHandlerContext) => Data<Contract> | Promise<Data<Contract>>,
): void {
  // The envelope type is derived from the contract; the cast is confined to this single boundary.
  const wrapped = async (input: ZodOutput<Contract["input"]>, context: PluginHandlerContext) => {
    try {
      return { ok: true as const, data: await handler(input, context) };
    } catch (error) {
      return { ok: false as const, error: normalizeError(error) };
    }
  };
  server.handle(contract, wrapped as never);
}
