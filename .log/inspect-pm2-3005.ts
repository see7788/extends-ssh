import Ssh from '../ubuntu-lib/ssh/index.ts';
(async () => { const ssh=new Ssh(); try { for (const command of ['ps -fp 2917,2418', 'pm2 jlist']) { const r=await ssh.execute(command); console.log(r.stdout); } } finally { ssh.dispose(); } })();
