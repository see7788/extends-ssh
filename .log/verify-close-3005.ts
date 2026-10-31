import Ssh from '../ubuntu-lib/ssh/index.ts';
(async () => {
  const ssh=new Ssh();
  try {
    const result=await ssh.execute(`set +e
ss -ltnp | grep -E ":3005[[:space:]]" || true
printf "---route---\\n"
test -e /www/server/panel/vhost/nginx/extends-ssh-sshForward-3005.conf && printf present || printf absent
printf "\\n---pm2---\\n"
pm2 jlist | grep -o vite-node-5173 || true`);
    console.log(result.stdout);
  } finally { ssh.dispose(); }
})();
