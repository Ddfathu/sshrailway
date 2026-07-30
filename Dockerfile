FROM ubuntu:22.04

# Batasi interaksi saat install paket OS
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js, Dropbear, Stunnel, dan tools pendukung
RUN apt-get update && apt-get install -y \
    stunnel4 \
    openssl \
    sudo \
    curl \
    bash \
    dropbear \
    python3 \
    nodejs \
    npm \
    net-tools \
    && rm -rf /var/lib/apt/lists/*

# 🔥 FIX UTAMA: Download binary BadVPN UDPGW yang sudah jadi (AMD64) agar Game Mode langsung aktif
RUN curl -fsSL -o /usr/local/bin/badvpn-udpgw https://github.com/dedefathu/badvpn-build/raw/main/badvpn-udpgw-linux-amd64 || \
    curl -fsSL -o /usr/local/bin/badvpn-udpgw https://raw.githubusercontent.com/ammDestination/badvpn-udpgw/master/badvpn-udpgw \
    && chmod +x /usr/local/bin/badvpn-udpgw

WORKDIR /app

# Salin seluruh source code ke dalam container
COPY . .

# Install dependencies Node.js jika ada package.json
RUN npm init -y && npm install ws 2>/dev/null || true

RUN mkdir -p /var/run/sshd /var/run/stunnel4 /etc/stunnel

# Siapkan entrypoint
RUN cp entrypoint.sh /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 8080
EXPOSE 8081

ENTRYPOINT ["/entrypoint.sh"]
