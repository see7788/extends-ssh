import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";


const nodejsStore: ImmerStateCreator<{
  nodejs: {
    root: string;
    version: string;
    architecture: string;
    sha256: string;
  };
}> = () => ({
  nodejs: {
    root: "/opt/node-v22.23.2-linux-x64",
    version: "22.23.2",
    architecture: "linux-x64",
    sha256: "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307",
  },
});

export default nodejsStore;
