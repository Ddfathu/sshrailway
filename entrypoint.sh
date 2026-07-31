#!/bin/bash

# 🔥 KUNCI UTAMA ANTI SUNEK: Buka limit socket container sedalam mungkin
ulimit -n 65535
ulimit -s unlimited

# =================================================================
# 🚀 ULTRA TURBO KERNEL TWEAKS (ANTI REKONEK & DAUR ULANG SOCKET) 🚀
# =================================================================
echo "[*] Mengoptimalkan antrean socket & pembersihan TIME_WAIT..."
sysctl -w net.ipv4.tcp_tw_reuse=1 2>/dev/null
sysctl -w net.ipv4.tcp_fin_timeout=15 2>/dev/null
sysctl -w net.core.default_qdisc=fq 2>/dev/null
sysctl -w net.ipv4.tcp_congestion_control=bbr 2>/dev/null

echo "[*] Mengatur ukuran buffer raksasa agar tidak tersedak..."
sysctl -w net.ipv4.tcp_rmem="4096 8388608 16777216" 2>/dev/null
sysctl -w net.ipv4.tcp_wmem="4096 8388608 16777216" 2>/dev/null
sysctl -w net.core.rmem_max=16777216 2>/dev/null
sysctl -w net.core.wmem_max=16777216 2>/dev/null
sysctl -w net.core.netdev_max_backlog=50000 2>/dev/null
sysctl -w net.ipv4.tcp_max_syn_backlog=8192 2>/dev/null

# =================================================================

USER_NAME="${SSH_USER:-dd}"
USER_PASS="${SSH_PASSWORD:-dd}"
PUBLIC_PORT="${PORT:-8080}"
SSL_INTERNAL_PORT="${SSL_INTERNAL_PORT:-2443}"
WS_INTERNAL_PORT="8880"

echo "[*] Membuat sertifikat SSL Stunnel dinamis (Jakarta Mode)..."
mkdir -p /etc/stunnel /var/run/stunnel4
openssl req -new -newkey rsa:2048 -days 365 -nodes -x509 \
    -subj "/C=ID/ST=Jakarta/L=Jakarta/O=RailwaySSH/CN=localhost" \
    -keyout /etc/stunnel/stunnel.pem -out /etc/stunnel/stunnel.pem
chmod 600 /etc/stunnel/stunnel.pem

echo "[*] Mengonfigurasi User SSH di Ubuntu..."
if ! id "$USER_NAME" &>/dev/null; then
    useradd -m -s /bin/bash "$USER_NAME"
    echo "$USER_NAME ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
fi
echo "$USER_NAME:$USER_PASS" | chpasswd

echo "[*] Membuat Banner Dropbear..."
cat << 'EOF' > /etc/dropbear_banner
==================================================
              👑 SELAMAT MENIKMATI 👑  
 🔹 MULTIPLEXER : NODE.JS JAVASCRIPT ENGINE  
 🔹 OS PLATFORM : UBUNTU (ANTI-HMAC BUG)  
 🔹 SSH SERVICE : DROPBEAR ENHANCED BUFFER  
==================================================
EOF

echo "[*] Memulai Dropbear Server di Port Lokal 22..."
/usr/sbin/dropbear -p 127.0.0.1:22 -b /etc/dropbear_banner -W 65536
sleep 1 

echo "[*] Mengonfigurasi Stunnel..."
cat <<EOF > /etc/stunnel/stunnel.conf
pid = /var/run/stunnel4/stunnel.pid
foreground = no
debug = 4

[ssh-ssl]
accept = 127.0.0.1:$SSL_INTERNAL_PORT
connect = 127.0.0.1:22
cert = /etc/stunnel/stunnel.pem
EOF

echo "[*] Memulai Stunnel Daemon..."
stunnel4 /etc/stunnel/stunnel.conf

echo "[*] Memulai WS-Proxy (JavaScript)..."
export WS_PORT="$WS_INTERNAL_PORT"
node ws-proxy.js &

# --- 🔥 UTAMA: JALANKAN BADVPN UDPGW UNTUK GAME MODE 🔥 ---
if [ -f /usr/local/bin/badvpn-udpgw ]; then
    echo "[*] Memulai BadVPN udpgw di Port Lokal 7300..."
    /usr/local/bin/badvpn-udpgw --listen-addr 127.0.0.1:7300 --max-clients 500 --max-connections-for-client 20 &
elif [ -f /app/badvpn-udpgw ]; then
    echo "[*] Memulai BadVPN udpgw (/app) di Port Lokal 7300..."
    /app/badvpn-udpgw --listen-addr 127.0.0.1:7300 --max-clients 500 --max-connections-for-client 20 &
else
    echo "[!] Binary badvpn-udpgw tidak ditemukan, mencoba menjalankan langsung..."
    badvpn-udpgw --listen-addr 127.0.0.1:7300 --max-clients 500 --max-connections-for-client 20 &>/dev/null &
fi

sleep 2

# Download binary cloudflared resmi
echo "[*] Mengunduh binary cloudflared resmi..."
curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared

# --- 🔥 PUSAT EKSEKUSI TUNNEL FIX SAKTI 🔥 ---

# 1. Named Tunnel (Argo Token Mode) + Bypass TLS Verifikasi Lokal
if [ -n "$CF" ]; then
    echo "[*] Menjalankan Cloudflare Named Tunnel (Argo Token Mode)..."
    cloudflared tunnel run --protocol http2 --no-tls-verify --token "$CF" > /tmp/named_tunnel.log 2>&1 &
fi

# 2. 🔥 FIX UTAMA QUICK TUNNEL MODE HTTPS (PORT 443 RESMI) 🔥
# Kita tembak langsung ke HTTPS lokal Stunnel dan matikan verifikasi TLS lokal.
# Ini biar Cloudflare Edge membuka port 443 resmi secara publik yang support SNI bug lu!
echo "[*] Menjalankan Cloudflare Quick Tunnel (Jalur HTTPS Port 443)..."
cloudflared tunnel --url "https://127.0.0.1:$SSL_INTERNAL_PORT" --protocol http2 --no-tls-verify > /tmp/cloudflared.log 2>&1 &

# =================================================================
# 🔥 DATA SUPPLIER LOOP BUAT MONITORING PANEL
# =================================================================
(
    while true; do
        CPU_MODEL=$(lscpu | grep 'Model name' | cut -d':' -f2 | sed -e 's/^[ \t]*//')
        [ -z "$CPU_MODEL" ] && CPU_MODEL=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d':' -f2 | sed -e 's/^[ \t]*//')
        [ -z "$CPU_MODEL" ] && CPU_MODEL="Railway Virtual CPU"

        RAM_TOTAL=$(free -h | awk '/Mem:/ {print $2}')
        RAM_USED=$(free -h | awk '/Mem:/ {print $3}')
        DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}')
        UPTIME=$(uptime -p | sed 's/up //')
        SSH_ONLINE=$(ps aux | grep -i dropbear | grep -v grep | grep -v '/usr/sbin/dropbear' | wc -l)
        
        CUSTOM_DOM="${D:-}"
        RLWY_DOM="${RLWY_PROXY:-}"

        cat <<EOF > /tmp/server_stats.json
{
  "cpu_model": "$CPU_MODEL",
  "ram_total": "$RAM_TOTAL",
  "ram_used": "$RAM_USED",
  "disk_usage": "$DISK_USAGE",
  "uptime": "$UPTIME",
  "ssh_online": "$SSH_ONLINE",
  "custom_domain": "$CUSTOM_DOM",
  "railway_proxy": "$RLWY_DOM"
}
EOF
        sleep 2
    done
) &

# 🔥 JALANKAN WEB DASHBOARD PANEL NODE.JS DI PORT 8081
echo "[*] Memulai Web Dashboard Panel (Node.js Engine) di Port 8081..."
node index.js &

sleep 2

# =================================================================
echo "[*] Memulai Muxer Utama (JavaScript)..."
export PORT="$PUBLIC_PORT"
export SSL_TARGET_PORT="$SSL_INTERNAL_PORT"
export WS_TARGET_PORT="$WS_INTERNAL_PORT"

exec node mux.js
