import Ssh from './ubuntu-lib/ssh/index.ts';
const ssh = new Ssh();
try {
 const r = await ssh.execute('grep -R -n "10003.forward.13520521413.store" /www/server/panel/vhost/nginx /www/server/nginx/conf 2>/dev/null | head -n 30; curl -k -sS -D - --max-time 8 --resolve 10003.forward.13520521413.store:443:127.0.0.1 https://10003.forward.13520521413.store/ -o /tmp/rdc-nginx-body; head -c 300 /tmp/rdc-nginx-body; echo; grep -R -n "10003\|upstream" /www/server/nginx/logs 2>/dev/null | tail -n 30');
 process.stdout.write(r.stdout);
} finally { ssh.dispose(); }
