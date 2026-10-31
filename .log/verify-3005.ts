import Ssh from '../ubuntu-lib/ssh/index.ts';
(async () => { const ssh=new Ssh(); try { const r=await ssh.execute('ss -ltnp; printf "---PM2---\\n"; pm2 describe 3005 || true'); console.log(r.stdout); } finally { ssh.dispose(); } })();
