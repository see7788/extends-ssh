import Pm2 from '../ubuntu-lib/pm2/index.ts';
import Nginx from '../ubuntu-lib/nginx/index.ts';
(async () => {
  const pm2 = new Pm2();
  await pm2.closeRemote(3005);
  const nginx = new Nginx('sshForward', 3005);
  await nginx.closeRemote();
  console.log(JSON.stringify({ closedPm2: true, closedNginxRoute: true }));
})();
