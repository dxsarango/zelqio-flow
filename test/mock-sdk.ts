import type { PluginRpcContract } from "@getpaseo/plugin";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import type { input as ZodInput, output as ZodOutput } from "zod";

type Handler = (input: unknown, context: PluginHandlerContext) => unknown;
type Registered = { contract: PluginRpcContract; handler: Handler };

/**
 * Test double for the plugin server context. It records RPC handlers and invokes them after parsing the input
 * and output with the contract's Zod schemas. This approximates, but is not, the SDK's wire behaviour
 * (`callPluginRpc` is not public API); wire-level behaviour is covered by the isolated-daemon check.
 * Only `handle` is implemented; anything else a plugin touches must be added deliberately.
 */
export function createMockServer(context: PluginHandlerContext = { paseo: {} as PluginHandlerContext["paseo"] }) {
  const handlers = new Map<string, Registered>();
  const server = {
    handle(contract: PluginRpcContract, handler: Handler) {
      if (handlers.has(contract.name)) throw new Error(`duplicate handler: ${contract.name}`);
      handlers.set(contract.name, { contract, handler });
    },
  } as unknown as PluginServerContext;

  async function call<Contract extends PluginRpcContract>(
    contract: Contract,
    input: ZodInput<Contract["input"]>,
  ): Promise<ZodOutput<Contract["output"]>> {
    const registered = handlers.get(contract.name);
    if (!registered) throw new Error(`no handler for ${contract.name}`);
    const parsedInput = contract.input.parse(input);
    const output = await registered.handler(parsedInput, context);
    return contract.output.parse(output) as ZodOutput<Contract["output"]>;
  }
  return { server, call, methods: () => [...handlers.keys()].sort() };
}
