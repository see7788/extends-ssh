import Ssh from '../ubuntu-lib/ssh/index.ts';
(async () => { const ssh=new Ssh(); try { const r=await ssh.execute('readlink -f /proc/2917/cwd; tr "\\0" " " < /proc/2917/cmdline; printf "\\n"; ps -fp 2917'); console.log(r.stdout); } finally { ssh.dispose(); } })();
