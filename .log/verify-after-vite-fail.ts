import Ssh from '../ubuntu-lib/ssh/index.ts';
(async () => { const ssh=new Ssh(); try { const r=await ssh.execute('ss -ltnp | grep -E ":3005[[:space:]]" || true'); console.log(r.stdout); } finally { ssh.dispose(); } })();
