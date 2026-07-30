import http.server
import socketserver
import re
import os
import json
import subprocess
import urllib.parse

PORT = 8081
LOG_PATH = "/tmp/cloudflared.log"
NAMED_LOG_PATH = "/tmp/named_tunnel.log" 
STATS_PATH = "/tmp/server_stats.json"
DB_PATH = "/tmp/ssh_details.json"  

# Password Admin diambil dari Environment Variable Railway, defaultnya 'admin123'
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

class DashboardHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    # Membaca database rahasia admin
    def load_db(self):
        if os.path.exists(DB_PATH):
            try:
                with open(DB_PATH, "r") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    # Menyimpan ke database rahasia admin
    def save_db(self, data):
        try:
            with open(DB_PATH, "w") as f:
                json.dump(data, f)
        except Exception:
            pass

    # 🛠️ FITUR MANAGEMENT SSH (UBUNTU / DROPBEAR MODE)
    def list_ssh(self):
        try:
            users = []
            db_info = self.load_db()
            with open("/etc/passwd", "r") as f:
                for line in f:
                    parts = line.strip().split(":")
                    username = parts[0]
                    uid = int(parts[2])
                    shell = parts[-1]
                    # FIX UBUNTU: Mengabaikan user bawaan Ubuntu dan Dropbear system
                    if uid >= 1000 and username not in ["nobody", "ubuntu", "sshd", "dropbear", "stunnel"]:
                        extra = db_info.get(username, {"password": "-", "ip": "Unknown", "user_agent": "Unknown"})
                        users.append({
                            "username": username, 
                            "uid": uid, 
                            "shell": shell,
                            **extra
                        })
            return {"status": "success", "total": len(users), "users": users}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def get_current_hosts(self):
        quick_url = "Menunggu Quick Tunnel..."
        named_url = ""
        if os.path.exists(STATS_PATH):
            try:
                with open(STATS_PATH, "r") as f:
                    hw_info = json.load(f)
                    if hw_info.get("custom_domain"):
                        named_url = hw_info["custom_domain"].replace("https://", "").replace("http://", "")
            except Exception:
                pass
        if os.path.exists(LOG_PATH):
            try:
                with open(LOG_PATH, "r") as f:
                    match = re.search(r'https://([a-zA-Z0-9-]+\.trycloudflare\.com)', f.read())
                    if match:
                        quick_url = match.group(1)
            except Exception:
                pass
        return named_url if named_url else quick_url

    def add_ssh(self, username, password, ip_addr, user_agent):
        if not username or not password:
            return {"status": "error", "message": "Username dan password wajib diisi!"}
        
        # Validasi keamanan input username
        if not re.match(r"^[a-zA-Z0-9_-]+$", username):
            return {"status": "error", "message": "Username mengandung karakter ilegal!"}

        try:
            # FIX UBUNTU: Menggunakan useradd bawaan Debian/Ubuntu basis
            cmd_user = f"useradd -m -s /bin/bash {username}"
            subprocess.run(cmd_user, shell=True, check=True)
            cmd_pass = f"echo '{username}:{password}' | chpasswd"
            subprocess.run(cmd_pass, shell=True, check=True)
            
            # SIMPAN IP, PASSWORD, DAN USER-AGENT KE DATABASE RAHASIA ADMIN
            db_info = self.load_db()
            db_info[username] = {
                "password": password,
                "ip": ip_addr,
                "user_agent": user_agent
            }
            self.save_db(db_info)

            active_host = self.get_current_hosts()
            account_details = (
                f"================================\n"
                f" ⚡ PREMIUM SSH ACCOUNT CREATED ⚡\n"
                f"================================\n"
                f"🔹 Host SSH  : {active_host}\n"
                f"🔹 Port TLS  : 443\n"
                f"🔹 Port NTLS : 80\n"
                f"🔹 Username  : {username}\n"
                f"🔹 Password  : {password}\n"
                f"================================\n"
                f" powered by : d e d e f a t h u\n"
                f"================================"
            )
            return {"status": "success", "message": account_details}
        except subprocess.CalledProcessError:
            return {"status": "error", "message": f"Gagal membuat user. Username '{username}' mungkin sudah terpakai."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def delete_ssh(self, username):
        if not username:
            return {"status": "error", "message": "Username wajib diisi!"}
        try:
            # FIX UBUNTU: Menggunakan userdel -r (menghapus user beserta home directory miliknya secara bersih)
            cmd_del = f"userdel -r {username}"
            subprocess.run(cmd_del, shell=True, check=True)
            
            # Hapus riwayat di database rahasia admin
            db_info = self.load_db()
            if username in db_info:
                del db_info[username]
                self.save_db(db_info)
                
            return {"status": "success", "message": f"User {username} berhasil dihapus dari Ubuntu!"}
        except subprocess.CalledProcessError:
            return {"status": "error", "message": f"Gagal menghapus user. User '{username}' tidak ditemukan di OS."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)

        ip_addr = self.headers.get("CF-Connecting-IP", self.client_address[0])
        user_agent = self.headers.get("User-Agent", "Unknown UA")

        if path == "/api/logtunnel":
            self.send_response(200)
            self.send_header("Content-type", "text/plain; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            
            if os.path.exists(NAMED_LOG_PATH):
                try:
                    with open(NAMED_LOG_PATH, "r") as f:
                        lines = f.readlines()
                        last_lines = "".join(lines[-70:])
                        self.wfile.write(last_lines.encode('utf-8'))
                except Exception as e:
                    self.wfile.write(f"Gagal membaca file log internal: {str(e)}".encode('utf-8'))
            else:
                self.wfile.write("File log /tmp/named_tunnel.log belum terbentuk di server, Bos! Pastikan token di env Railway sudah terisi dengan benar.".encode('utf-8'))
            return

        if path == "/api/add":
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            username = query.get("user", [None])[0]
            password = query.get("pass", [None])[0]
            response_data = self.add_ssh(username, password, ip_addr, user_agent)
            self.wfile.write(json.dumps(response_data).encode('utf-8'))
            return

        if path == "/api/delete":
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            token = query.get("token", [None])[0]
            if token != ADMIN_PASSWORD:
                self.wfile.write(json.dumps({"status": "error", "message": "Akses Ditolak! Cuma admin yang boleh hapus!"}).encode('utf-8'))
                return
            username = query.get("user", [None])[0]
            response_data = self.delete_ssh(username)
            self.wfile.write(json.dumps(response_data).encode('utf-8'))
            return

        if path == "/api/list":
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(self.list_ssh()).encode('utf-8'))
            return

        if path == "/api/login":
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            pass_attempt = query.get("pass", [None])[0]
            if pass_attempt == ADMIN_PASSWORD:
                res = {"status": "success", "token": ADMIN_PASSWORD}
            else:
                res = {"status": "error", "message": "Password Admin Salah!"}
            self.wfile.write(json.dumps(res).encode('utf-8'))
            return

        if path == "/api/stats":
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            quick_url = "Menunggu Quick Tunnel siap..."
            status = "ONLINE"
            hw_info = {"cpu_model": "Loading...", "ram_total": "0", "ram_used": "0", "disk_usage": "0%", "uptime": "0", "ssh_online": "0", "custom_domain": ""}
            if os.path.exists(STATS_PATH):
                try:
                    with open(STATS_PATH, "r") as f:
                        hw_info = json.load(f)
                except Exception:
                    pass
            if os.path.exists(LOG_PATH):
                try:
                    with open(LOG_PATH, "r") as f:
                        match = re.search(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com', f.read())
                        if match:
                            quick_url = match.group(0)
                except Exception:
                    pass
            named_url = "Tidak Aktif (Token Kosong)"
            if hw_info.get("custom_domain"):
                named_url = "https://" + hw_info["custom_domain"].replace("https://", "").replace("http://", "")
            response_data = {"quick_url": quick_url, "named_url": named_url, "status": status, **hw_info}
            self.wfile.write(json.dumps(response_data).encode('utf-8'))
            return

        self.send_response(200)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.end_headers()
        
        html = """
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
                    <div class="dev-tag">DYNAMIC DUAL-TUNNEL CORE ACTIVE</div>
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
                    <div class="stat-card" style="border-color: #a855f7;"><div class="stat-title" style="color:#d8b4fe;">SSH Online Users</div><div class="stat-value" id="ssh" style="font-size:18px; color:#a855f7;">👥 0 Users</div></div>
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

                <div class="url-section">
                    <div class="url-title">2. Quick Tunnel (Link Acak Bumper Worker)</div>
                    <div class="url-box" id="quick-url">Loading...</div>
                    <button class="btn-copy" id="btn-copy-quick" onclick="copyTxt('quick-url', 'btn-copy-quick')">📋 COPY LINK ACAK WORKER</button>
                </div>
                <p class="note">Dua tunnel berjalan beriringan tanpa bentrok.<br>Salin link acak di atas ke dalam bumper Worker lu.</p>
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
                        let res = await fetch(`/api/login?pass=${pass}`);
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

                async function updateStats() {
                    try {
                        let res = await fetch('/api/stats');
                        let data = await res.json();
                        document.getElementById('cpu').innerText = data.cpu_model;
                        document.getElementById('ram').innerText = data.ram_used + " / " + data.ram_total;
                        document.getElementById('disk').innerText = data.disk_usage;
                        document.getElementById('uptime').innerText = data.uptime;
                        document.getElementById('ssh').innerText = "👥 " + data.ssh_online + " Users";
                        document.getElementById('named-url').innerText = data.named_url;
                        document.getElementById('quick-url').innerText = data.quick_url;
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
                                tbody.innerHTML += `
                                    <tr>
                                        <td style="font-weight:bold; color:#f1f5f9;">👤 ${u.username}</td>
                                        <td style="color:#64748b;">${u.shell}</td>
                                        <td style="text-align: right;">
                                            <div class="btn-action-group">
                                                <button class="btn-info" onclick="showAccountDetails('${u.username}')">👁️ INFO</button>
                                                <button class="btn-del" onclick="deleteAccount('${u.username}')">HAPUS</button>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            });
                            checkAdminUI();
                        } else {
                            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#64748b;">Belum ada akun SSH kustom</td></tr>`;
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
                        let res = await fetch(`/api/add?user=${user}&pass=${pass}`);
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
                    if(confirm(`Hapus akun SSH '${username}'?`)) {
                        try {
                            let res = await fetch(`/api/delete?user=${username}&token=${adminToken}`);
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
                            btn.style.background = elementId === 'named-url' ? '#a855f7' : '#38bdf8';
                            btn.style.color = elementId === 'named-url' ? '#fff' : '#090d16';
                        }, 1500);
                    }
                }

                setInterval(updateStats, 2000);
                updateStats();
                fetchAccounts();
            </script>
        </body>
        </html>
        """
        try:
            self.wfile.write(html.encode('utf-8'))
        except Exception:
            pass

if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), DashboardHandler) as httpd:
        print(f"Dual Tunnel Panel UI running at port {PORT}")
        httpd.serve_forever()
