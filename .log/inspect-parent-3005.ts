import Ssh from '../ubuntu-lib/ssh/index.ts';
(async () => { const ssh=new Ssh(); try { const r=await ssh.execute('ps -fp 2418; readlink -f /proc/2418/cwd; tr "\\0" " " < /proc/2418/cmdline; printf "\\n"'); console.log(r.stdout); } finally { ssh.dispose(); } })();
