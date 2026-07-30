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

sleep 2

# Download binary cloudflared resmi
echo "[*] Mengunduh binary cloudflared resmi..."
curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared

# --- 🔥 PUSAT EKSEKUSI DOUBLE TUNNEL JAVASCRIPT MODE 🔥 ---

# 1. Jalankan Named Tunnel HANYA JIKA token diisi di Railway
if [ -n "$CF" ]; then
    echo "[*] Menjalankan Cloudflare Named Tunnel (Argo Token Mode)..."
    cloudflared tunnel run --protocol http2 --token "$CF" > /tmp/named_tunnel.log 2>&1 &
fi

# 2. Jalankan Quick Tunnel (Link Acak TCP Mode)
echo "[*] Menjalankan Cloudflare Quick Tunnel (Link Acak TCP Mode)..."
cloudflared tunnel --url "tcp://127.0.0.1:$PUBLIC_PORT" --protocol http2 > /tmp/cloudflared.log 2>&1 &

# =================================================================

echo "[*] Memulai Muxer Utama (JavaScript)..."
export PORT="$PUBLIC_PORT"
export SSL_TARGET_PORT="$SSL_INTERNAL_PORT"
export WS_TARGET_PORT="$WS_INTERNAL_PORT"

exec node mux.js
