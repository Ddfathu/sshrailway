const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 8081;
const LOG_PATH = "/tmp/cloudflared.log";
const NAMED_LOG_PATH = "/tmp/named_tunnel.log";
const STATS_PATH = "/tmp/server_stats.json";
const DB_PATH = "/tmp/ssh_details.json";

// Password Admin diambil dari Environment Variable Railway, defaultnya 'admin123'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Fungsi pembantu membaca database rahasia admin
function loadDb() {
    if (fs.existsSync(DB_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        } catch (e) {
            return {};
        }
    }
    return {};
}

// Fungsi pembantu menyimpan database rahasia admin
function saveDb(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) {}
}

// Mengambil domain aktif untuk struk akun
function getCurrentHosts() {
    const namedUrl = process.env.D || "";
    let quickUrl = "Menunggu Quick Tunnel...";
    
    if (fs.existsSync(LOG_PATH)) {
        try {
            const logContent = fs.readFileSync(LOG_PATH, 'utf8');
            const match = logContent.match(/https?:\/\/([a-zA-Z0-9-]+\.trycloudflare\.com)/);
            if (match) {
                quickUrl = match[1];
            }
        } catch (e) {}
    }
    
    let hostOutput = "";
    if (namedUrl) hostOutput += `${namedUrl.replace(/https?:\/\//, '')} (Argo)`;
    if (process.env.RLWY_PROXY) hostOutput += ` / ${process.env.RLWY_PROXY.replace(/https?:\/\//, '')} (Server SNI)`;
    if (!hostOutput) hostOutput = quickUrl.replace(/https?:\/\//, '');
    
    return hostOutput;
}

// 🛠️ FITUR MANAGEMENT SSH (UBUNTU / DROPBEAR MODE)
function listSsh() {
    try {
        const users = [];
        const dbInfo = loadDb();
        const passwdContent = fs.readFileSync('/etc/passwd', 'utf8');
        const lines = passwdContent.split('\n');
        
        for (let line of lines) {
            if (!line.trim()) continue;
            const parts = line.split(':');
            const username = parts[0];
            const uid = parseInt(parts[2], 10);
            const shell = parts[parts.length - 1];
            
            // FIX UBUNTU: Mengabaikan user bawaan sistem Ubuntu, Stunnel, dan Dropbear
            if (uid >= 1000 && !["nobody", "ubuntu", "sshd", "dropbear", "stunnel"].includes(username)) {
                const extra = dbInfo[username] || { password: "-", ip: "Unknown", user_agent: "Unknown" };
                users.push({
                    username: username,
                    uid: uid,
                    shell: shell,
                    ...extra
                })
            }
        }
        return { status: "success", total: users.length, users: users };
    } catch (e) {
        return { status: "error", message: e.message };
    }
}

function addSsh(username, password, ipAddr, userAgent) {
    if (!username || !password) {
        return { status: "error", message: "Username dan password wajib diisi!" };
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return { status: "error", message: "Username mengandung karakter ilegal!" };
    }
    
    try {
        execSync(`useradd -m -s /bin/bash ${username}`);
        execSync(`echo '${username}:${password}' | chpasswd`);
        
        const dbInfo = loadDb();
        dbInfo[username] = {
            password: password,
            ip: ipAddr,
            user_agent: userAgent
        };
        saveDb(dbInfo);
        
        const activeHost = getCurrentHosts();
        const accountDetails = 
            `================================\n` +
            ` ⚡ PREMIUM SSH ACCOUNT CREATED ⚡\n` +
            `================================\n` +
            `🔹 Host SSH  : ${activeHost}\n` +
            `🔹 Port TLS  : 443\n` +
            `🔹 Port NTLS : 80\n` +
            `🔹 Username  : ${username}\n` +
            `🔹 Password  : ${password}\n` +
            `================================\n` +
            ` powered by : d e d e f a t h u\n` +
            `================================`;
        return { status: "success", message: accountDetails };
    } catch (e) {
        return { status: "error", message: `Gagal membuat user. Username '${username}' mungkin sudah terpakai.` };
    }
}

function deleteSsh(username) {
    if (!username) {
        return { status: "error", message: "Username wajib diisi!" };
    }
    try {
        execSync(`userdel -r ${username}`);
        
        const dbInfo = loadDb();
        if (dbInfo[username]) {
            delete dbInfo[username];
            saveDb(dbInfo);
        }
        return { status: "success", message: `User ${username} berhasil dihapus dari Ubuntu!` };
    } catch (e) {
        return { status: "error", message: `Gagal menghapus user. User '${username}' tidak ditemukan di OS.` };
    }
}

// PEMBUATAN HTTP SERVER ENGINE 
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathName = parsedUrl.pathname;
    const query = parsedUrl.query;
    
    const ipAddr = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || "Unknown IP";
    const userAgent = req.headers['user-agent'] || "Unknown UA";
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (pathName === '/api/logtunnel') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        if (fs.existsSync(NAMED_LOG_PATH)) {
            try {
                const logContent = fs.readFileSync(NAMED_LOG_PATH, 'utf8');
                const lines = logContent.split('\n');
                const lastLines = lines.slice(-70).join('\n');
                res.end(lastLines);
            } catch (e) {
                res.end(`Gagal membaca file log internal: ${e.message}`);
            }
        } else {
            res.end("File log /tmp/named_tunnel.log belum terbentuk di server, Bos!");
        }
        return;
    }
    
    if (pathName === '/api/add') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const result = addSsh(query.user, query.pass, ipAddr, userAgent);
        res.end(JSON.stringify(result));
        return;
    }
    
    if (pathName === '/api/delete') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (query.token !== ADMIN_PASSWORD) {
            res.end(JSON.stringify({ status: "error", message: "Akses Ditolak! Cuma admin yang boleh hapus!" }));
            return;
        }
        const result = deleteSsh(query.user);
        res.end(JSON.stringify(result));
        return;
    }
    
    if (pathName === '/api/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(listSsh()));
        return;
    }
    
    if (pathName === '/api/login') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (query.pass === ADMIN_PASSWORD) {
            res.end(JSON.stringify({ status: "success", token: ADMIN_PASSWORD }));
        } else {
            res.end(JSON.stringify({ status: "error", message: "Password Admin Salah!" }));
        }
        return;
    }
    
    if (pathName === '/api/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        let quickUrl = "Menunggu Quick Tunnel siap...";
        let hwInfo = { cpu_model: "Loading...", ram_total: "0", ram_used: "0", disk_usage: "0%", uptime: "0", ssh_online: "0 Users", user_list_details: "Semua user offline", custom_domain: "", railway_proxy: "" };
        
        if (fs.existsSync(STATS_PATH)) {
            try {
                hwInfo = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
            } catch (e) {}
        }
        if (fs.existsSync(LOG_PATH)) {
            try {
                const logContent = fs.readFileSync(LOG_PATH, 'utf8');
                const match = logContent.match(/https?:\/\/([a-zA-Z0-9-]+\.trycloudflare\.com)/);
                if (match) quickUrl = match[1];
            } catch (e) {}
        }
        
        let namedUrl = "Tidak Aktif (Token Kosong)";
        if (process.env.CF && process.env.D) {
            namedUrl = process.env.D.replace(/https?:\/\//, '');
        }
        
        let rlwyUrl = process.env.RLWY_PROXY ? process.env.RLWY_PROXY.replace(/https?:\/\//, '') : "Tidak Aktif (TCP Proxy Belum Ditambah)";
        
        const responseData = { quick_url: quickUrl, named_url: namedUrl, railway_url: rlwyUrl, status: "ONLINE", ...hwInfo };
        res.end(JSON.stringify(responseData));
        return;
    }
    
    // RENDER UI DASHBOARD UTAMA HTML LU BOS
    if (pathName === '/' || pathName === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const html = `
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <title>⚡ PREMIUM SSH RAILWAY PANEL ⚡</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: '-apple-system', BlinkMacSystemFont, sans-serif; background: #090d16; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 15px; }
                .container { background: #111827; width: 100%; max-width: 500px; padding: 25px; border-radius: 16px; box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.8); border: 1px solid #1f2937; }
                .header { text-align: center; margin-bottom: 20px; position: relative; }
                h1 { font-size: 20px; color: #38bdf8; text-transform: uppercase; letter-spacing: 1px; }
                .dev-tag { font-size: 11px; color: #64748b; margin-top: 4px; font-weight: bold; }
                .btn-login-trigger { position: absolute; top: 0; right: 0; background: #334155; color: #f8fafc; border: 1px solid #4b5563; padding: 4px 8px; border-radius: 6px; font-size: 10px; cursor: pointer; font-weight: bold; }
                .status-container { text-align: center; margin-bottom: 15px; }
                .status-badge { display: inline-block; background: #1f2937; padding: 5px 12px; border-radius: 50px; font-size: 11px; font-weight: bold; border: 1px solid #334155; }
                .status-dot { height: 8px; width: 8px; background-color: #4ade80; border-radius: 50%; display: inline-block; margin-right: 6px; box-shadow: 0 0 8px #4ade80; }
                .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
                .stat-card { background: #1f2937; padding: 12px; border-radius: 8px; border: 1px solid #334155; text-align: left; }
                .stat-title { font-size: 11px; color: #94a3b8; text-transform: uppercase; }
                .stat-value { font-size: 14px; font-weight: bold; color: #f1f5f9; margin-top: 4px; }
                .ssh-manager { background: #1f2937; padding: 15px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 20px; position: relative;}
                .ssh-title { font-size: 13px; font-weight: bold; color: #38bdf8; text-transform: uppercase; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
                .input-group { display: flex; gap: 8px; margin-bottom: 10px; }
                .input-ssh { background: #030712; border: 1px solid #4b5563; padding: 8px 12px; border-radius: 6px; color: #fff; font-size: 13px; width: 100%; }
                .btn-add { background: #38bdf8; color: #090d16; border: none; padding: 8px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 13px; }
                .admin-status-lbl { font-size: 10px; font-weight: bold; color: #38bdf8; background: rgba(56, 189, 248, 0.1); padding: 2px 6px; border-radius: 4px; }
                .result-box { display: none; background: #030712; border: 1px solid #4ade80; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; color: #4ade80; white-space: pre-wrap; margin-bottom: 15px; overflow-x: hidden; }
                .btn-copy-result { display: none; background: #4ade80; color: #090d16; border: none; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px; width: 100%; margin-bottom: 15px; }
                
                .ssh-list { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
                .ssh-list th { text-align: left; padding: 6px; color: #94a3b8; border-bottom: 1px solid #334155; }
                .ssh-list td { padding: 6px; border-bottom: 1px solid #1f2937; vertical-align: middle; }
                
                .btn-action-group { display: flex; gap: 4px; justify-content: flex-end; }
                .btn-del { background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; display: none; }
                .btn-info { background: #eab308; color: #090d16; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold; display: none; }
                
                .url-section { background: #030712; border: 1px solid #38bdf8; padding: 12px; border-radius: 8px; margin-bottom: 12px; text-align: center; }
                .url-title { font-size: 11px; color: #94a3b8; font-weight: bold; text-transform: uppercase; }
                .url-box { font-family: monospace; font-size: 13px; word-break: break-all; color: #38bdf8; font-weight: bold; margin: 6px 0; }
                .btn-copy { background: #38bdf8; color: #090d16; border: none; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px; width: 100%; }
                .note { font-size: 11px; color: #64748b; text-align: center; line-height: 1.4; margin-top: 10px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>👑 DDFATHU DOUBLE MONITOR 👑</h1>
                    <div class="dev-tag">DYNAMIC TRIPLE-TUNNEL NODE CORE ACTIVE</div>
                    <button class="btn-login-trigger" id="admin-login-btn" onclick="promptAdminLogin()">🔑 LOGIN ADMIN</button>
                </div>
                
                <div class="status-container">
                    <div class="status-badge"><span class="status-dot"></span><span style="color: #4ade80">TUNNELS ONLINE</span></div>
                </div>

                <div class="stats-grid">
                    <div class="stat-card" style="grid-column: span 2;"><div class="stat-title">CPU Model</div><div class="stat-value" id="cpu" style="font-size:12px; color:#38bdf8;">Loading...</div></div>
                    <div class="stat-card"><div class="stat-title">RAM Used / Total</div><div class="stat-value" id="ram">Loading...</div></div>
                    <div class="stat-card"><div class="stat-title">Disk Usage (/)</div><div class="stat-value" id="disk">Loading...</div></div>
                    <div class="stat-card"><div class="stat-title">Server Uptime</div><div class="stat-value" id="uptime" style="font-size:12px;">Loading...</div></div>
                    <div class="stat-card" style="border-color: #a855f7;"><div class="stat-title" style="color:#d8b4fe;">SSH Online Users</div><div class="stat-value" id="ssh" style="font-size:14px; color:#a855f7; line-height: 1.3;">Loading Users...</div></div>
                </div>

                <div class="ssh-manager">
                    <div class="ssh-title">
                        <span>➕ Buat Akun SSH Baru</span>
                        <span id="admin-indicator" class="admin-status-lbl">PUBLIC CREATION</span>
                    </div>
                    
                    <div class="input-group">
                        <input type="text" id="ssh-user" class="input-ssh" placeholder="Username...">
                        <input type="password" id="ssh-pass" class="input-ssh" placeholder="Password...">
                        <button class="btn-add" id="btn-add-ssh" onclick="createAccount()">ADD</button>
                    </div>
                    
                    <div id="ssh-result" class="result-box"></div>
                    <button id="btn-copy-acc" class="btn-copy-result" onclick="copyAccountText()">📋 COPY DETAIL AKUN</button>
                    <div id="ssh-msg" style="font-size: 11px; margin-top: 5px; font-weight: bold;"></div>
                    
                    <div class="ssh-title" style="margin-top: 15px; border-top: 1px solid #334155; padding-top: 10px;">📋 Daftar Akun Terdaftar</div>
                    <table class="ssh-list">
                        <thead><tr><th>Username</th><th>Shell Path</th><th style="text-align: right;">Aksi</th></tr></thead>
                        <tbody id="ssh-table-body"><tr><td colspan="3" style="text-align:center; color:#64748b;">Loading accounts...</td></tr></tbody>
                    </table>
                </div>
                
                <div class="url-section" style="border-color: #a855f7;">
                    <div class="url-title" style="color: #d8b4fe;">1. Named Tunnel (Domain Utama)</div>
                    <div class="url-box" id="named-url">Loading...</div>
                    <button class="btn-copy" id="btn-copy-named" style="background:#a855f7; color:#fff;" onclick="copyTxt('named-url', 'btn-copy-named')">📋 COPY DOMAIN UTAMA</button>
                </div>

                <div class="url-section" style="border-color: #f43f5e;">
                    <div class="url-title" style="color: #fb7185;">2. Server SNI</div>
                    <div class="url-box" id="railway-url" style="color: #f43f5e;">Loading...</div>
                    <button class="btn-copy" id="btn-copy-railway" style="background:#f43f5e; color:#fff;" onclick="copyTxt('railway-url', 'btn-copy-railway')">📋 COPY ALAMAT TCP PROXY</button>
                </div>

                <div class="url-section">
                    <div class="url-title">3. Quick Tunnel (Link Acak Bumper Worker)</div>
                    <div class="url-box" id="quick-url">Loading...</div>
                    <button class="btn-copy" id="btn-copy-quick" onclick="copyTxt('quick-url', 'btn-copy-quick')">📋 COPY LINK ACAK WORKER</button>
                </div>
                <p class="note">Tiga rute tunnel berjalan sinkron tanpa bentrok.<br>Node.js Core Engine Rendering System.</p>
            </div>

            <script>
                let adminToken = localStorage.getItem("admin_session_token") || "";
                let savedUsersData = []; 

                function checkAdminUI() {
                    let indicator = document.getElementById('admin-indicator');
                    let loginBtn = document.getElementById('admin-login-btn');
                    
                    if(adminToken) {
                        indicator.innerText = "ADMIN ROUTE";
                        indicator.style.color = "#4ade80";
                        indicator.style.background = "rgba(74, 222, 128, 0.1)";
                        loginBtn.innerText = "🔒 LOGOUT";
                        
                        document.querySelectorAll('.btn-del').forEach(b => b.style.display = "inline-block");
                        document.querySelectorAll('.btn-info').forEach(b => b.style.display = "inline-block");
                    } else {
                        indicator.innerText = "PUBLIC CREATION";
                        indicator.style.color = "#38bdf8";
                        indicator.style.background = "rgba(56, 189, 248, 0.1)";
                        loginBtn.innerText = "🔑 LOGIN ADMIN";
                        
                        document.querySelectorAll('.btn-del').forEach(b => b.style.display = "none");
                        document.querySelectorAll('.btn-info').forEach(b => b.style.display = "none");
                    }
                }

                async function promptAdminLogin() {
                    if(adminToken) {
                        localStorage.removeItem("admin_session_token");
                        adminToken = "";
                        checkAdminUI();
                        fetchAccounts();
                        return;
                    }
                    let pass = prompt("Masukkan Password Admin:");
                    if(!pass) return;
                    
                    try {
                        let res = await fetch(\`/api/login?pass=\${pass}\`);
                        let data = await res.json();
                        if(data.status === "success") {
                            adminToken = data.token;
                            localStorage.setItem("admin_session_token", adminToken);
                            checkAdminUI();
                            fetchAccounts();
                        } else {
                            alert(data.message);
                        }
                    } catch(e) { alert("Gagal terhubung ke API Login"); }
                }

                function cleanUrl(urlStr) {
                    if(!urlStr) return "";
                    return urlStr.replace(/^https?:\/\//i, '').replace(/\/$/, '');
                }

                async function updateStats() {
                    try {
                        let res = await fetch('/api/stats');
                        let data = await res.json();
                        document.getElementById('cpu').innerText = data.cpu_model;
                        document.getElementById('ram').innerText = data.ram_used + " / " + data.ram_total;
                        document.getElementById('disk').innerText = data.disk_usage;
                        document.getElementById('uptime').innerText = data.uptime;
                        
                        document.getElementById('ssh').innerHTML = \`\${data.ssh_online}<br><span style="font-size:11px; font-weight:normal; color:#d8b4fe; display:block; margin-top:5px; white-space:pre-line;">\${data.user_list_details || 'Semua user offline'}</span>\`;
                        
                        // Menghilangkan https:// langsung di tampilan box UI frontend
                        document.getElementById('named-url').innerText = cleanUrl(data.named_url);
                        document.getElementById('railway-url').innerText = cleanUrl(data.railway_url);
                        document.getElementById('quick-url').innerText = cleanUrl(data.quick_url);
                    } catch(e) { console.log(e); }
                }

                async function fetchAccounts() {
                    try {
                        let res = await fetch('/api/list');
                        let data = await res.json();
                        let tbody = document.getElementById('ssh-table-body');
                        tbody.innerHTML = "";
                        
                        if(data.status === "success" && data.users.length > 0) {
                            savedUsersData = data.users; 
                            data.users.forEach(u => {
                                tbody.innerHTML += \`
                                    <tr>
                                        <td style="font-weight:bold; color:#f1f5f9;">👤 \${u.username}</td>
                                        <td style="color:#64748b;">\${u.shell}</td>
                                        <td style="text-align: right;">
                                            <div class="btn-action-group">
                                                <button class="btn-info" onclick="showAccountDetails('\${u.username}')">👁️ INFO</button>
                                                <button class="btn-del" onclick="deleteAccount('\${u.username}')">HAPUS</button>
                                            </div>
                                        </td>
                                    </tr>
                                \`;
                            });
                            checkAdminUI();
                        } else {
                            tbody.innerHTML = \`<tr><td colspan="3" style="text-align:center; color:#64748b;">Belum ada akun SSH kustom</td></tr>\`;
                        }
                    } catch(e) { console.log(e); }
                }

                function showAccountDetails(username) {
                    let userObj = savedUsersData.find(u => u.username === username);
                    if(userObj) {
                        alert(
                            "🕵️ DATA RAHASIA PEMBUAT AKUN:\\n" +
                            "===============================\\n" +
                            "👤 Username   : " + userObj.username + "\\n" +
                            "🔑 Password   : " + userObj.password + "\\n" +
                            "🌐 IP Address : " + userObj.ip + "\\n" +
                            "📱 User-Agent : " + userObj.user_agent
                        );
                    }
                }

                async function createAccount() {
                    let user = document.getElementById('ssh-user').value.trim();
                    let pass = document.getElementById('ssh-pass').value.trim();
                    let msg = document.getElementById('ssh-msg');
                    let resBox = document.getElementById('ssh-result');
                    let copyBtn = document.getElementById('btn-copy-acc');
                    
                    if(!user || !pass) {
                        msg.style.color = "#ef4444";
                        msg.innerText = "Isi username & password dulu!";
                        return;
                    }
                    try {
                        let res = await fetch(\`/api/add?user=\${user}&pass=\${pass}\`);
                        let data = await res.json();
                        if(data.status === "success") {
                            msg.innerText = "";
                            resBox.innerText = data.message;
                            resBox.style.display = "block";
                            copyBtn.style.display = "block";
                            document.getElementById('ssh-user').value = "";
                            document.getElementById('ssh-pass').value = "";
                            fetchAccounts();
                        } else {
                            msg.style.color = "#ef4444";
                            msg.innerText = data.message;
                            resBox.style.display = "none";
                            copyBtn.style.display = "none";
                        }
                    } catch(e) { msg.innerText = "Gagal memproses API"; }
                }

                function copyAccountText() {
                    let txt = document.getElementById('ssh-result').innerText;
                    navigator.clipboard.writeText(txt);
                    let btn = document.getElementById('btn-copy-acc');
                    btn.innerText = "✅ STRUK AKUN BERHASIL DICOPY!";
                    btn.style.background = "#1f2937";
                    btn.style.color = "#4ade80";
                    setTimeout(() => {
                        btn.innerText = "📋 COPY DETAIL AKUN";
                        btn.style.background = "#4ade80";
                        btn.style.color = "#090d16";
                    }, 1500);
                }

                async function deleteAccount(username) {
                    if(!adminToken) {
                        alert("Aksi Ilegal! Lu harus Login Admin dulu Bos!");
                        return;
                    }
                    if(confirm(\`Hapus akun SSH '\${username}'?\`)) {
                        try {
                            let res = await fetch(\`/api/delete?user=\${username}&token=\${adminToken}\`);
                            let data = await res.json();
                            if(data.status === "success") {
                                fetchAccounts();
                            } else {
                                alert(data.message);
                            }
                        } catch(e) { console.log(e); }
                    }
                }

                function copyTxt(elementId, btnId) {
                    let urlText = document.getElementById(elementId).innerText;
                    if(!urlText.includes("Menunggu") && !urlText.includes("Tidak Aktif")) {
                        navigator.clipboard.writeText(urlText);
                        let btn = document.getElementById(btnId);
                        let oldText = btn.innerText;
                        btn.innerText = "✅ COPIED!";
                        btn.style.background = "#4ade80";
                        btn.style.color = "#090d16";
                        setTimeout(() => {
                            btn.innerText = oldText;
                            if (elementId === 'named-url') { btn.style.background = '#a855f7'; btn.style.color = '#fff'; }
                            else if (elementId === 'railway-url') { btn.style.background = '#f43f5e'; btn.style.color = '#fff'; }
                            else { btn.style.background = '#38bdf8'; btn.style.color = '#090d16'; }
                        }, 1500);
                    }
                }

                setInterval(updateStats, 2000);
                updateStats();
                fetchAccounts();
            </script>
        </body>
        </html>
        `;
        res.end(html);
        return;
    }
    
    // Default 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end("Not Found");
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Node Panel Engine] Running seamlessly on port ${PORT}`);
});
