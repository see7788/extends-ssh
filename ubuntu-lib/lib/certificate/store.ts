import { posix } from "node:path";
import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";
import { z } from "zod";

const defaultRoot = "/etc/extends-ssh/certificates";
export const certificateRootValidator = z.string().trim().min(1).refine(
  value => value.startsWith("/") && !value.includes("\0") && !value.includes("\\") && posix.normalize(value) === value,
);

const certificateStore: ImmerStateCreator<{
  certificate: {
    root: string;
  };
}> = () => ({
  certificate: {
    root: defaultRoot,
  },
});

export default certificateStore;
