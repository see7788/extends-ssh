import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";

const SshForward: ImmerStateCreator<{
  SshForward: { devPort: number };
}> = () => ({
  SshForward: { devPort: 3478 },
});

export default SshForward