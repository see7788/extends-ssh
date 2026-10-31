import Ssh from '../ubuntu-lib/ssh/index.ts';
(async () => {
  const ssh = new Ssh();
  try {
    for (const command of ['ss -ltnp', 'ps -ef | grep "[s]shd"']) {
      const result = await ssh.execute(command);
      console.log(JSON.stringify({ command, stdout: result.stdout, stderr: result.stderr }, null, 2));
    }
  } finally {
    ssh.dispose();
  }
})();
