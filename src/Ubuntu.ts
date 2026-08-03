import fs from 'fs';
import path from 'path';
import { fileURLToPath } from "url"
import { NodeSSH } from 'node-ssh';
import store from "./store.ts";

class SSH {
    private ssh = new NodeSSH();
    private readonly store = store;
    private get sshConfig() {
        return this.store.getState().sshConfig;
    }
    remoteRootDir = '/root/data';
    private sshConnected_: boolean = false // 变量名同步优化（从sshConnect_改为sshConnected_）   
    async sshIsConnect(): Promise<void> {
        if (this.sshConnected_) {
            console.log("✅ SSH已连接");
            return;
        }
        try {
            console.log("🔌 建立SSH连接...");
            await this.ssh.connect(this.sshConfig);
            console.log(`📁 初始化目录: ${this.remoteRootDir}`);
            await this.execCommand(`mkdir -p "${this.remoteRootDir}"`);

            // ========== 核心：整合apt验证 + 基础工具安装（连接时一次性检测） ==========
            console.log("📦 检测Ubuntu 22.04基础环境（apt+核心工具）...");
            const aptCheckScript = `
        set -e
        # 1. 验证apt是否可用（Ubuntu自带，仅检测不安装）
        if [ ! -f "/usr/bin/apt" ] || ! apt --version >/dev/null 2>&1; then
            echo "❌ apt包管理器异常（Ubuntu核心组件缺失）"
            exit 1
        fi
        echo "✅ apt包管理器验证通过（Ubuntu 22.04自带）"

        # 2. 仅首次更新apt源（避免重复更新，提升速度）
        if [ ! -f "/root/.apt_updated" ]; then
            echo "📡 更新apt源（适配华为云）..."
            apt update -y >/dev/null 2>&1
            touch /root/.apt_updated
        fi

        # 3. 检查并安装核心工具（按需安装，跳过已安装）
        required_tools=("lsof" "net-tools" "unzip" "wget" "ufw" "sudo" "curl" "git" "ca-certificates" "gnupg" "lsb-release")
        for tool in "\${required_tools[@]}"; do
            if ! dpkg -s "\$tool" >/dev/null 2>&1; then
                echo "📦 安装基础工具：\$tool"
                apt install -y "\$tool" >/dev/null 2>&1
            else
                echo "✅ 基础工具已安装：\$tool"
            fi
        done

        # 4. 确保ufw防火墙启动（端口管理必需）
        systemctl enable ufw --now >/dev/null 2>&1 || true
        echo "✅ Ubuntu 22.04基础环境检测完成"
        `;
            await this.execCommand(aptCheckScript);


            this.sshConnected_ = true;
            console.log("✅ SSH连接成功（所有基础环境已验证）");
        } catch (error) {
            this.sshConnected_ = false;
            throw new Error(`🚨 SSH连接/基础环境检测失败: ${error instanceof Error ? error.message : error}`);
        }
    }
    async execCommand(cmd: string) {
        const execResult = await this.ssh.execCommand(cmd, {
            onStdout: chunk => process.stdout.write(chunk.toString()),
            onStderr: chunk => process.stderr.write(chunk.toString()),
        });
        if (execResult.code !== 0) {
            throw new Error(`失败码:${execResult.code}\nstdout: ${execResult.stdout}\nstderr: ${execResult.stderr}`);
        }
        return execResult;
    }
    dispose() {
        this.ssh.dispose();
        this.sshConnected_ = false;
    }
    async nvmInstalled(): Promise<void> {
        await this.sshIsConnect();
        await this.execCommand(`
set -euo pipefail
NODE_VERSION=22.23.2
NODE_ARCHIVE=node-v$NODE_VERSION-linux-x64.tar.xz
NODE_ROOT=/opt/node-v$NODE_VERSION-linux-x64
if [ ! -x "$NODE_ROOT/bin/node" ]; then
    apt-get update -qq
    apt-get install -y -qq xz-utils >/dev/null
    cd /tmp
    rm -f "$NODE_ARCHIVE"
    curl -fL --connect-timeout 15 --max-time 180 --retry 2 -o "$NODE_ARCHIVE" \
        "https://npmmirror.com/mirrors/node/v$NODE_VERSION/$NODE_ARCHIVE" || \
    curl -fL --connect-timeout 15 --max-time 180 --retry 2 -o "$NODE_ARCHIVE" \
        "https://nodejs.org/download/release/v$NODE_VERSION/$NODE_ARCHIVE"
    echo 'd60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307  node-v22.23.2-linux-x64.tar.xz' | sha256sum -c -
    rm -rf "$NODE_ROOT"
    tar -xJf "$NODE_ARCHIVE" -C /opt
    rm -f "$NODE_ARCHIVE"
fi
NODE_BIN_DIR="$NODE_ROOT/bin"
for command_name in node npm npx corepack; do
    if [ -x "$NODE_BIN_DIR/$command_name" ]; then ln -sf "$NODE_BIN_DIR/$command_name" "/usr/local/bin/$command_name"; fi
done
export PATH="/usr/local/bin:$NODE_BIN_DIR:$PATH"
node -e "if (process.versions.node !== '22.23.2') process.exit(1)"
if ! command -v pnpm >/dev/null 2>&1; then /usr/local/bin/npm install -g pnpm; fi
for command_name in pnpm pnpx; do
    command_path=$(command -v "$command_name" 2>/dev/null || true)
    if [ -n "$command_path" ]; then ln -sf "$command_path" "/usr/local/bin/$command_name"; fi
done
/usr/local/bin/node --version
/usr/local/bin/npm --version
`);
        this.store.setState(state => { state.nvmIsInstalled = true; });
    }

    async httpserverIsInstalled(): Promise<void> {
        await this.nvmInstalled();
        await this.execCommand(`
set -e
if ! command -v http-server >/dev/null 2>&1; then npm install -g http-server; fi
HTTP_SERVER="$(npm prefix -g)/bin/http-server"
test -x "$HTTP_SERVER"
ln -sf "$HTTP_SERVER" /usr/local/bin/http-server
/usr/local/bin/http-server -v
`);
        this.store.setState(state => { state.httpserverIsInstalled = true; });
    }

    async pm2IsRunning(): Promise<void> {
        await this.nvmInstalled();
        await this.execCommand(`
set -e
if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2; fi
PM2="$(npm prefix -g)/bin/pm2"
test -x "$PM2"
ln -sf "$PM2" /usr/local/bin/pm2
pm2 ping >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null
pm2 save --force >/dev/null
systemctl enable pm2-root >/dev/null
systemctl is-enabled --quiet pm2-root
pm2 --version
`);
        this.store.setState(state => { state.pm2IsRunning = true; });
    }
    async dockerIsRunning(): Promise<void> {
        try {
            if (this.store.getState().dockerIsRunning) {
                console.log("✅ dockerIsRunning");
                return
            }
            await this.sshIsConnect()
            // 移除不必要的nvmIsInstalled调用（Docker和Node无关）
            const checkAndStartScript = `
        set -e
        # 修复：添加--no-install-recommends减少冗余安装
        export DEBIAN_FRONTEND=noninteractive
        if ! command -v docker >/dev/null 2>&1; then
            echo "📌 安装Docker..."
            rm -f /etc/apt/sources.list.d/docker.list /etc/apt/trusted.gpg.d/docker.gpg
            apt-get update -y
            apt-get install -y --no-install-recommends docker.io
        fi

        if [ "$(systemctl is-active docker)" != "active" ]; then
            systemctl enable docker --now
            sleep 2
        fi

        # 验证Docker是否真的启动
        if ! docker info >/dev/null 2>&1; then
            echo "❌ Docker启动失败"
            exit 1
        fi

        echo "✅ Docker已运行"
        `;
            await this.execCommand(checkAndStartScript);
            this.store.setState(s => { s.dockerIsRunning = true; });
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            throw new Error(`🚨 Docker检查/启动失败: ${errorMsg}`);
        }
    }
    async portInUse(port: number, protocol: 'tcp' | 'udp' = 'tcp'): Promise<boolean> {
        try {
            await this.sshIsConnect()
            let checkCmd = '';
            if (protocol === 'tcp') {
                // 优先用ss命令（Ubuntu 22.04推荐）
                checkCmd = `ss -tlnp | grep ":${port}" | wc -l`;
            } else {
                checkCmd = `ss -ulnp | grep ":${port}" | wc -l`;
            }

            const result = await this.execCommand(checkCmd);
            const portUseCount = parseInt(result.stdout.trim() || '0');
            const isInUse = portUseCount > 0;

            console.log(`📌 端口${port}/${protocol} ${isInUse ? '已占用' : '未占用'}`);
            return isInUse;
        } catch (error) {
            // 降级用lsof（保留兼容）
            console.log('⚠️ ss命令执行失败，尝试用lsof检查端口');
            let lsofCmd = '';
            if (protocol === 'tcp') {
                lsofCmd = `lsof -iTCP:${port} -sTCP:LISTEN | grep -v "PID" | wc -l`;
            } else {
                lsofCmd = `lsof -iUDP:${port} | grep -v "PID" | wc -l`;
            }
            const result = await this.execCommand(lsofCmd);
            const portUseCount = parseInt(result.stdout.trim() || '0');
            const isInUse = portUseCount > 0;

            console.log(`📌 端口${port}/${protocol} ${isInUse ? '已占用' : '未占用'}`);
            return isInUse;
        }
    }
    async portClose(port: number): Promise<void> {
        try {
            await this.sshIsConnect();
            // 先停止PM2中对应端口的进程
            console.log(`🗑️ 停止PM2中端口${port}的进程...`);
            await this.execCommand(`
            PM2_NAME="http-server-${port}";
            pm2 stop \$PM2_NAME > /dev/null 2>&1 || true;
            pm2 delete \$PM2_NAME > /dev/null 2>&1 || true;
            pm2 save > /dev/null 2>&1 || true;
            sleep 0.5;
        `);

            const killPortProcess = async (protocol: 'tcp' | 'udp') => {
                console.log(`🗑️ 关闭端口${port}/${protocol}进程...`);
                await this.execCommand(`
                PIDS=\$(lsof -t -i${protocol === 'tcp' ? 'TCP' : 'UDP'}:${port} ${protocol === 'tcp' ? '-sTCP:LISTEN' : ''}) || true;
                if [ -n "\$PIDS" ]; then
                    kill -9 \$PIDS 2>/dev/null;
                    echo "✅ 杀死所有PID: \$PIDS";
                else
                    echo "ℹ️ 无占用进程";
                fi;
                sleep 0.5;
            `);
            };
            await killPortProcess('tcp');
            await killPortProcess('udp');

            console.log(`🗑️ 检查Docker容器映射...`);
            try {
                await this.execCommand(`command -v docker`);
                const containerIds = (await this.execCommand(`docker ps -q --filter "publish=${port}"`)).stdout.trim().split('\n').filter(Boolean);
                if (containerIds.length > 0) {
                    await this.execCommand(`docker rm -f ${containerIds.join(' ')}`);
                    console.log(`✅ 关闭容器: ${containerIds.join(', ')}`);
                } else {
                    console.log(`ℹ️ 无映射容器`);
                }
            } catch {
                console.log(`ℹ️ 未安装Docker，跳过`);
            }

            const verifyPortFree = async (protocol: 'tcp' | 'udp') => {
                try {
                    const res = await this.execCommand(protocol === 'tcp'
                        ? `netstat -antulp | grep ":${port}" | grep LISTEN | wc -l`
                        : `netstat -anulp | grep ":${port}" | wc -l`);
                    return parseInt(res.stdout.trim() || '0') === 0;
                } catch {
                    return true;
                }
            };
            const isTcpFree = await verifyPortFree('tcp');
            const isUdpFree = await verifyPortFree('udp');

            if (!isTcpFree || !isUdpFree) {
                const checkPid = await this.execCommand(`lsof -t -i:${port} 2>/dev/null || echo ""`);
                if (checkPid.stdout.trim()) {
                    // 兜底杀死剩余PID
                    await this.execCommand(`kill -9 ${checkPid.stdout.trim()} 2>/dev/null || true; sleep 0.5;`);
                    // 二次校验
                    const recheck = await this.execCommand(`lsof -t -i:${port} 2>/dev/null || echo ""`);
                    if (recheck.stdout.trim()) {
                        throw new Error(`⚠️ 端口${port}(${!isTcpFree ? 'TCP' : ''}${!isTcpFree && !isUdpFree ? '/' : ''}${!isUdpFree ? 'UDP' : ''})仍被占用(PID: ${recheck.stdout.trim()})`);
                    } else {
                        console.log(`✅ 兜底杀死剩余PID，端口已释放`);
                    }
                } else {
                    console.log(`⚠️ 端口${port}无进程占用，忽略监听状态`);
                }
            }
            console.log(`✅ 端口${port}已释放`);
        } catch (error) {
            throw new Error(`🚨 关闭端口${port}失败: ${error instanceof Error ? error.message : error}`);
        }
    }











    /** 最终官方适配版：完全遵循官方启动命令，解决Coturn重启问题 */
    async coturnIsRunning(): Promise<void> {
        // 1. 缓存检查：已运行则直接返回
        if (this.store.getState().coturnIsRunning) {
            console.log("✅ Coturn 服务已在运行（缓存命中）");
            return;
        }

        try {
            // 2. 前置依赖检查
            await this.sshIsConnect();
            await this.dockerIsRunning();

            // 3. 读取配置参数（严格匹配官方端口）
            const state = this.store.getState();
            const coturnDefaultPort = state.coturn_default_port; // 3478
            const coturnTlsPort = state.coturn_tls_port; // 5349
            const coturnRelayPort = state.coturn_relay_port_start; // 49152
            const huaweiRegistry = "https://bda2e0b50ea149e3867236334e75da97.mirror.swr.myhuaweicloud.com";

            // 4. 完全适配官方命令的脚本
            const optimizedScript = `
        set +e
        echo "🔧 清理旧容器（严格匹配官方命名）..."
        # 清理官方命名的容器
        docker rm -f coturn >/dev/null 2>&1
        if [ $? -eq 0 ]; then
            echo "✅ 旧容器清理完成"
        else
            echo "ℹ️ 无旧容器需要清理"
        fi
        
        # 释放端口（TCP+UDP）
        release_port() {
            local port=\$1
            echo "🔍 释放端口\$port（TCP+UDP）..."
            # 杀死TCP占用进程
            PIDS_TCP=\$(lsof -t -iTCP:\$port) 2>/dev/null
            [ -n "\$PIDS_TCP" ] && kill -9 \$PIDS_TCP && echo "✅ 杀死TCP进程: \$PIDS_TCP"
            
            # 杀死UDP占用进程
            PIDS_UDP=\$(lsof -t -iUDP:\$port) 2>/dev/null
            [ -n "\$PIDS_UDP" ] && kill -9 \$PIDS_UDP && echo "✅ 杀死UDP进程: \$PIDS_UDP"
            
            [ -z "\$PIDS_TCP" ] && [ -z "\$PIDS_UDP" ] && echo "ℹ️ 端口\$port未被占用"
        }
        
        release_port ${coturnDefaultPort}
        release_port ${coturnTlsPort}
        release_port ${coturnRelayPort}

        # 配置华为云镜像源
        echo "🐳 配置华为云镜像源..."
        mkdir -p /etc/docker
        if ! grep -q "swr.myhuaweicloud.com" /etc/docker/daemon.json 2>/dev/null; then
            echo '{
                "registry-mirrors": ["${huaweiRegistry}"]
            }' > /etc/docker/daemon.json
            systemctl daemon-reload && systemctl restart docker
            sleep 3
            echo "✅ 华为云镜像源配置完成"
        else
            echo "✅ 华为云镜像源已配置，跳过"
        fi

        # 拉取官方镜像（严格匹配官方tag）
        echo "📥 拉取Coturn官方镜像..."
        COTURN_IMAGE=coturn/coturn:latest
        docker pull "$COTURN_IMAGE"
        if [ $? -ne 0 ]; then
            echo "❌ Coturn镜像拉取失败，降级拉取4.5.2版本..."
            COTURN_IMAGE=coturn/coturn:4.5.2
            docker pull "$COTURN_IMAGE"
            [ $? -ne 0 ] && echo "❌ Coturn镜像拉取失败" && exit 1
        fi
        
        # ===================== 1. 启动Coturn（完全复制官方命令） =====================
        echo "🚀 启动Coturn（官方命令）..."
        docker run -d \
            --privileged \
            --restart=unless-stopped \
            --name coturn \
            -p ${coturnDefaultPort}:${coturnDefaultPort} \
            -p ${coturnDefaultPort}:${coturnDefaultPort}/udp \
            -p ${coturnTlsPort}:${coturnTlsPort} \
            -p ${coturnTlsPort}:${coturnTlsPort}/udp \
            -p ${coturnRelayPort}:${coturnRelayPort}/udp \
            "$COTURN_IMAGE"
        
        # 等待Coturn启动（官方镜像启动较慢）
        sleep 10
        
        # 验证Coturn状态
        COTURN_STATUS=\$(docker inspect -f '{{.State.Running}}' coturn 2>/dev/null)
        if [ "\$COTURN_STATUS" != "true" ]; then
            echo "❌ Coturn启动失败，日志："
            docker logs coturn
            exit 1
        fi
        echo "✅ Coturn启动成功（匹配官方命令）"

        # 最终验证：检查端口映射
        echo "🔍 验证端口映射..."
        docker ps --filter "name=coturn"
        echo -e "\\n✅ 所有服务启动成功（完全匹配官方命令）！"
        exit 0
        `;

            // 执行脚本并捕获详细输出
            const execResult = await this.execCommand(optimizedScript);
            console.log("📜 脚本执行输出：", execResult.stdout);

            // 检查脚本退出码
            if (execResult.code !== 0) {
                throw new Error(`脚本执行失败，退出码：${execResult.code}，错误输出：${execResult.stderr}`);
            }

            // 兜底验证：检查容器是否真的运行
            const coturnStatus = await this.execCommand(
                `docker inspect -f '{{.State.Running}}' coturn`,
            );

            if (coturnStatus.stdout.trim() !== "true") {
                const coturnLogs = await this.execCommand(`docker logs coturn`);
                throw new Error(`
❌ 容器未正常运行：
- Coturn状态：${coturnStatus.stdout.trim()}
- Coturn日志：${coturnLogs.stdout}
            `.trim());
            }

            // 更新状态
            this.store.setState(s => { s.coturnIsRunning = true; });
            console.log("✅ Coturn 服务启动成功");

        } catch (e) {
            this.store.setState(s => { delete s.coturnIsRunning; });
            const errorMsg = e instanceof Error ? e.message : String(e);
            throw new Error(`🚨 Coturn 启动失败: ${errorMsg}`);
        }
    }
    async peerjsIsRunning(): Promise<void> {
        if (this.store.getState().peerjsIsRunning) {
            console.log("✅ PeerJS 服务已在运行（缓存命中）");
            return;
        }

        try {
            await this.sshIsConnect();
            await this.dockerIsRunning();

            const peerServerPort = this.store.getState().peerServer_port;
            const huaweiRegistry = "https://bda2e0b50ea149e3867236334e75da97.mirror.swr.myhuaweicloud.com";
            const startScript = `
        set -e
        docker rm -f peerjs >/dev/null 2>&1 || true

        PIDS_TCP=\$(lsof -t -iTCP:${peerServerPort} 2>/dev/null || true)
        if [ -n "\$PIDS_TCP" ]; then
            kill -9 \$PIDS_TCP
        fi

        mkdir -p /etc/docker
        if ! grep -q "swr.myhuaweicloud.com" /etc/docker/daemon.json 2>/dev/null; then
            echo '{
                "registry-mirrors": ["${huaweiRegistry}"]
            }' > /etc/docker/daemon.json
            systemctl daemon-reload
            systemctl restart docker
            sleep 3
        fi

        PEERJS_IMAGE=peerjs/peerjs-server:latest
        if ! docker pull "\$PEERJS_IMAGE"; then
            PEERJS_IMAGE=peerjs/peerjs-server:0.6.1
            docker pull "\$PEERJS_IMAGE"
        fi

        docker run -d \
            --restart=unless-stopped \
            --name peerjs \
            -p ${peerServerPort}:${peerServerPort} \
            "\$PEERJS_IMAGE"

        sleep 3
        test "\$(docker inspect -f '{{.State.Running}}' peerjs 2>/dev/null)" = "true"
        `;
            const execResult = await this.execCommand(startScript);
            if (execResult.code !== 0) {
                throw new Error(execResult.stderr || `脚本退出码 ${execResult.code}`);
            }

            const peerjsStatus = await this.execCommand(
                `docker inspect -f '{{.State.Running}}' peerjs`,
            );
            if (peerjsStatus.stdout.trim() !== "true") {
                const peerjsLogs = await this.execCommand("docker logs peerjs");
                throw new Error(`PeerJS 容器未正常运行：${peerjsLogs.stdout}`);
            }

            this.store.setState(s => { s.peerjsIsRunning = true; });
            console.log("✅ PeerJS 服务启动成功");
        } catch (error) {
            this.store.setState(s => { delete s.peerjsIsRunning; });
            throw new Error(`🚨 PeerJS 启动失败: ${error instanceof Error ? error.message : error}`);
        }
    }
    async emailSmtpIsRunning(): Promise<void> {
        if (this.store.getState().emailSmtpIsRunning) {
            console.log("✅ email SMTP submission已运行");
            return;
        }

        try {
            await this.sshIsConnect();
            const rootPath = path.resolve(process.env.EMAIL_ROOT_PATH || process.cwd());
            const rootPkg = JSON.parse(fs.readFileSync(path.resolve(rootPath, "package.json"), "utf8"));
            const emailServer = rootPkg.config?.emailServer;
            const smtpSend = emailServer?.smtpSend;

            if (!emailServer?.domain) {
                throw new Error("config.emailServer.domain is required");
            }

            if (!smtpSend?.user || !smtpSend?.pass) {
                throw new Error("config.emailServer.smtpSend.user/pass is required");
            }

            if (Number(smtpSend.port) !== 587) {
                throw new Error("config.emailServer.smtpSend.port must be 587");
            }

            const shellText = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;
            const domain = emailServer.domain;
            const smtpUser = smtpSend.user;
            const smtpPass = smtpSend.pass;
            const serverHost = this.sshConfig.host;
            const installScript = `
set -e
export DEBIAN_FRONTEND=noninteractive
DOMAIN=${shellText(domain)}
SMTP_USER=${shellText(smtpUser)}
SMTP_PASS=${shellText(smtpPass)}

hostnamectl set-hostname "mail.$DOMAIN" >/dev/null 2>&1 || true
echo "mail.$DOMAIN" > /etc/mailname
debconf-set-selections <<< "postfix postfix/mailname string $DOMAIN"
debconf-set-selections <<< "postfix postfix/main_mailer_type string 'Internet Site'"

apt update -y
apt install -y postfix opendkim opendkim-tools libsasl2-modules sasl2-bin mailutils

postconf -e "myhostname = mail.$DOMAIN"
postconf -e "mydomain = $DOMAIN"
postconf -e "myorigin = $DOMAIN"
postconf -e "inet_interfaces = all"
postconf -e "inet_protocols = ipv4"
postconf -e "mydestination = localhost"
postconf -e "mynetworks = 127.0.0.0/8"
postconf -e "smtpd_sasl_auth_enable = yes"
postconf -e "smtpd_sasl_type = cyrus"
postconf -e "smtpd_sasl_path = smtpd"
postconf -e "smtpd_sasl_security_options = noanonymous"
postconf -e "smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination"
postconf -e "smtp_tls_security_level = may"
postconf -e "smtpd_tls_security_level = may"
postconf -e "smtpd_tls_auth_only = no"
postconf -e "milter_default_action = accept"
postconf -e "milter_protocol = 6"
postconf -e "smtpd_milters = inet:127.0.0.1:8891"
postconf -e "non_smtpd_milters = inet:127.0.0.1:8891"

postconf -M# smtp/inet 2>/dev/null || sed -i 's/^smtp[[:space:]]\\+inet/#smtp inet/' /etc/postfix/master.cf
postconf -M submission/inet="submission inet n - y - - smtpd"
postconf -P submission/inet/syslog_name=postfix/submission
postconf -P submission/inet/smtpd_tls_security_level=may
postconf -P submission/inet/smtpd_sasl_auth_enable=yes
postconf -P submission/inet/smtpd_relay_restrictions=permit_sasl_authenticated,reject

mkdir -p /etc/postfix/sasl
cat > /etc/postfix/sasl/smtpd.conf <<'EOF'
pwcheck_method: auxprop
auxprop_plugin: sasldb
mech_list: plain login
sasldb_path: /etc/sasldb2
EOF
printf "%s\\n" "$SMTP_PASS" | saslpasswd2 -p -c "$SMTP_USER"
chgrp postfix /etc/sasldb2
chmod 640 /etc/sasldb2

mkdir -p "/etc/opendkim/keys/$DOMAIN"
if [ ! -f "/etc/opendkim/keys/$DOMAIN/mail.private" ]; then
    opendkim-genkey -b 2048 -s mail -d "$DOMAIN" -D "/etc/opendkim/keys/$DOMAIN"
fi
chown -R opendkim:opendkim "/etc/opendkim/keys/$DOMAIN"
chmod 600 "/etc/opendkim/keys/$DOMAIN/mail.private"

cat > /etc/opendkim.conf <<'EOF'
Syslog yes
UMask 002
Mode sv
Canonicalization relaxed/simple
Socket inet:8891@127.0.0.1
PidFile /run/opendkim/opendkim.pid
OversignHeaders From
KeyTable /etc/opendkim/key.table
SigningTable refile:/etc/opendkim/signing.table
ExternalIgnoreList /etc/opendkim/trusted.hosts
InternalHosts /etc/opendkim/trusted.hosts
EOF
cat > /etc/opendkim/key.table <<EOF
mail._domainkey.$DOMAIN $DOMAIN:mail:/etc/opendkim/keys/$DOMAIN/mail.private
EOF
cat > /etc/opendkim/signing.table <<EOF
*@$DOMAIN mail._domainkey.$DOMAIN
EOF
cat > /etc/opendkim/trusted.hosts <<EOF
127.0.0.1
localhost
$DOMAIN
mail.$DOMAIN
EOF

systemctl enable opendkim postfix >/dev/null 2>&1
systemctl restart opendkim postfix

if command -v ufw >/dev/null 2>&1; then
    ufw allow 587/tcp >/dev/null 2>&1 || true
    ufw reload >/dev/null 2>&1 || true
fi

if ! ss -tlnp | grep ':587 '; then
    journalctl -u postfix -n 80 --no-pager
    journalctl -u opendkim -n 80 --no-pager
    exit 1
fi

echo "DNS_SPF: v=spf1 ip4:${serverHost} -all"
echo "DNS_DKIM:"
cat "/etc/opendkim/keys/$DOMAIN/mail.txt"
echo "DNS_DMARC: v=DMARC1; p=quarantine; rua=mailto:postmaster@$DOMAIN"
`;

            await this.execCommand(installScript);
            this.store.setState({ emailSmtpIsRunning: true });
            console.log("✅ email SMTP submission启动成功");
        } catch (error) {
            throw new Error(`🚨 email SMTP submission启动失败: ${error instanceof Error ? error.message : error}`);
        }
    }


    get peerjsState(): {
        peerServer: {
            host: string;
            port: number;
        };
        stunServer: {
            host: string;
            port: number;
        };
    } {
        const { peerServer_port, coturn_default_port } = this.store.getState();
        return {
            peerServer: {
                host: this.sshConfig.host,
                port: peerServer_port // 用变量替代9000
            },
            stunServer: {
                host: this.sshConfig.host,
                port: coturn_default_port // 用变量替代3478
            }
        }
    }
}
const ubuntu = new SSH()
/**直接运行脚本时执行  npx tsx ./Ubuntu.ts*/
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
    (async () => {
        try {
            // await ubuntu.coturnIsRunning()
            // await ubuntu.peerjsIsRunning()
            await ubuntu.sshIsConnect()
            const execResult = await ubuntu.execCommand("ss -tulpn | grep 3007 || true")
            if (execResult.stdout.trim()) {
                console.log("port 3007 is listening")
            } else {
                console.log("port 3007 is not listening")
            }
            console.log("success")
        } finally {
            ubuntu.dispose()
        }
    })()
}
export default ubuntu
