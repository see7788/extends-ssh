import Ssh from '../ubuntu-lib/ssh/index.ts';
(async () => {
  const ssh = new Ssh();
  try {
    const command = `set -e
pm2 delete vite-node-5173 >/dev/null 2>&1 || true
pm2 save --force >/dev/null 2>&1 || true
route='/www/server/panel/vhost/nginx/extends-ssh-sshForward-3005.conf'
rm -f "$route"
nginx='/www/server/nginx/sbin/nginx'
config='/www/server/nginx/conf/nginx.conf'
"$nginx" -t -c "$config" >/dev/null
master=$(pgrep -xo nginx || true)
if [ -n "$master" ]; then kill -HUP "$master"; fi
printf 'closed vite-node-5173 and removed sshForward route for 3005\\n'`;
    const result = await ssh.execute(command);
    console.log(result.stdout);
  } finally {
    ssh.dispose();
  }
})();
