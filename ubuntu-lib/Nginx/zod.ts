import { posix } from "node:path";
import { z } from "zod";

const devPortValidator = z.number().int().min(1).max(65_535);
const serviceValidator = z.enum(["sftp", "pm2", "sshForward"]);
export const inputValidator = z.object({ service: serviceValidator, port: devPortValidator }).strict();
const pathValidator = z.string().trim()
  .regex(/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/, "path 必须是 Linux 绝对路径")
  .refine(value => {
    const basename = posix.basename(value);
    const port = Number(basename);
    return String(port) === basename && Number.isInteger(port) && port >= 1 && port <= 65_535;
  }, "path 末段必须是 1-65535 的开发端口");
export const makeInputValidator = z.object({
  service: serviceValidator,
  port: devPortValidator.optional(),
  path: pathValidator.optional(),
}).strict().refine(input => (input.port === undefined) !== (input.path === undefined), "port 与 path 必须二选一");
