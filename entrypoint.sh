#!/bin/bash

ulimit -n 65535
ulimit -s unlimited

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
# -W 65536 = Sinkronisasi buffer raksasa
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
# Mencoba mendeteksi lokasi binary udpgw baik di /usr/local/bin atau /app
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

# --- 🔥 PUSAT EKSEKUSI DOUBLE TUNNEL MURNI BAWAN LU 🔥 ---

# 1. Named Tunnel (Argo Token)
if [ -n "$CF" ]; then
    echo "[*] Menjalankan Cloudflare Named Tunnel (Argo Token Mode)..."
    cloudflared tunnel run --protocol http2 --token "$CF" > /tmp/named_tunnel.log 2>&1 &
fi

# 2. Quick Tunnel (Link Acak TCP)
echo "[*] Menjalankan Cloudflare Quick Tunnel (Link Acak TCP Mode)..."
cloudflared tunnel --url "tcp://127.0.0.1:$PUBLIC_PORT" --protocol http2 > /tmp/cloudflared.log 2>&1 &

# =================================================================
# 🔥 DATA SUPPLIER LOOP BUAT INDEX.PY (BIAR GRAFIKNYA NYALA LIVE)
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
        
        # Masukkan domain kustom dari variabel D lu bos
        CUSTOM_DOM="${D:-}"

        cat <<EOF > /tmp/server_stats.json
{
  "cpu_model": "$CPU_MODEL",
  "ram_total": "$RAM_TOTAL",
  "ram_used": "$RAM_USED",
  "disk_usage": "$DISK_USAGE",
  "uptime": "$UPTIME",
  "ssh_online": "$SSH_ONLINE",
  "custom_domain": "$CUSTOM_DOM"
}
EOF
        sleep 2
    done
) &

# 🔥 JALANKAN WEB DASHBOARD PANEL PYTHON DI PORT 8081
echo "[*] Memulai Web Dashboard Panel di Port 8081..."
python3 index.py &

sleep 2

# =================================================================

echo "[*] Memulai Muxer Utama (JavaScript)..."
export PORT="$PUBLIC_PORT"
export SSL_TARGET_PORT="$SSL_INTERNAL_PORT"
export WS_TARGET_PORT="$WS_INTERNAL_PORT"

exec node mux.js
