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

# --- 🔥 PUSAT EKSEKUSI TUNNEL 🔥 ---

# 1. Named Tunnel (Argo Token Mode)
if [ -n "$CF" ]; then
    echo "[*] Menjalankan Cloudflare Named Tunnel (Argo Token Mode)..."
    cloudflared tunnel run --protocol http2 --no-tls-verify --token "$CF" > /tmp/named_tunnel.log 2>&1 &
fi

# 2. Quick Tunnel (BALIK KE MODE HTTP BIAR SUBDOMAIN ACAK KELUAR TEPAT SASARAN)
echo "[*] Menjalankan Cloudflare Quick Tunnel (Link Acak Engine)..."
cloudflared tunnel --url "http://127.0.0.1:$PUBLIC_PORT" --protocol http2 > /tmp/cloudflared.log 2>&1 &

# =================================================================
# 🔥 DATA SUPPLIER LOOP VERSI INTELIJEN SAKTI (PORT CONNECTION TRACKER)
# =================================================================
(
    while true; do
        CPU_MODEL=$(lscpu | grep 'Model name' | cut -d':' -f2 | sed -e 's/^[ \t]*//')
        [ -z "$CPU_MODEL" ] && CPU_MODEL=$(grep -m1 'model name' /proc/procinfo 2>/dev/null | cut -d':' -f2 | sed -e 's/^[ \t]*//')
        [ -z "$CPU_MODEL" ] && CPU_MODEL="Railway Virtual CPU"

        RAM_TOTAL=$(free -h | awk '/Mem:/ {print $2}')
        RAM_USED=$(free -h | awk '/Mem:/ {print $3}')
        DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}')
        UPTIME=$(uptime -p | sed 's/up //')
        
        # Hitung koneksi established ke port Dropbear lokal (22)
        COUNT_ONLINE=$(cat /proc/net/tcp 2>/dev/null | grep -i '0100007F:0016' | wc -l)
        
        USER_DETAILS_LIST=""
        if [ "$COUNT_ONLINE" -gt 0 ]; then
            RAW_USER_LIST=$(cat /etc/passwd | awk -F: '$3>=1000 {print $1}' | grep -v -E 'nobody|ubuntu')
            for u in $RAW_USER_LIST; do
                if ps aux | grep -i "$u" | grep -v grep &>/dev/null; then
                    USER_DETAILS_LIST="${USER_DETAILS_LIST}👤 User Active: ${u}\\n"
                fi
            done
        fi

        if [ -z "$USER_DETAILS_LIST" ] || [ "$COUNT_ONLINE" -eq 0 ]; then
            USER_DETAILS_LIST="Semua user offline"
            SSH_ONLINE="0 Users"
        else
            SSH_ONLINE="${COUNT_ONLINE} Users"
        fi

        CUSTOM_DOM="${D:-}"
        RLWY_DOM="${SNI:-}"

        cat <<EOF > /tmp/server_stats.json
{
  "cpu_model": "$CPU_MODEL",
  "ram_total": "$RAM_TOTAL",
  "ram_used": "$RAM_USED",
  "disk_usage": "$DISK_USAGE",
  "uptime": "$UPTIME",
  "ssh_online": "👥 $SSH_ONLINE Active",
  "user_list_details": "$USER_DETAILS_LIST",
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
