import type { ImmerStateCreator } from "zustand-lib/immerStateCreator";


const sftpStore: ImmerStateCreator<{
  sftp: {
    remoteRoot: "/www/wwwroot/extends-ssh";
  };
}> = () => ({
  sftp: {
    remoteRoot: "/www/wwwroot/extends-ssh",
  },
});

export default sftpStore;
