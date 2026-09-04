import { emptyValidator, mcpRegister, read, type McpJsonContext } from "../mcpBase.ts";
import store from "../store/index.ts";
import { z } from "zod";

export const stateValidator = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
}).strict();

export type State = z.infer<typeof stateValidator>;

export default class Public {
  public get state(): State {
    return stateValidator.parse(store.getState().public);
  }
}

export const publicConfig = new Public();

export const publicSlice = mcpRegister.slice("public").tool(
  "post",
  "/state",
  emptyValidator,
  "读取公共域名。",
  read,
  (context: McpJsonContext<{}>) => context.json(publicConfig.state),
);
