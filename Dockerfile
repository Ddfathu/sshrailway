FROM ubuntu:22.04 AS builder

# Batasi interaksi saat install paket OS
ENV DEBIAN_FRONTEND=noninteractive

# Install tools untuk compile dari source resmi
RUN apt-get update && apt-get install -y \
    cmake \
    make \
    gcc \
    g++ \
    curl \
    tar \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Download dan compile badvpn-udpgw langsung dari release resmi github
RUN curl -fsSL https://github.com/ambrop72/badvpn/archive/refs/tags/1.999.130.tar.gz | tar -xz \
    && cd badvpn-1.999.130 \
    && mkdir build && cd build \
    && cmake .. -DBUILD_NOTHING_BY_DEFAULT=1 -DBUILD_UDPGW=1 \
    && make badvpn-udpgw

# =================================================================
FROM ubuntu:22.04

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

# 🔥 AMAN: Salin binary udpgw yang udah sukses dicompile dari stage builder di atas
COPY --from=builder /src/badvpn-1.999.130/build/udpgw/badvpn-udpgw /usr/local/bin/badvpn-udpgw
RUN chmod +x /usr/local/bin/badvpn-udpgw

WORKDIR /app

# Salin seluruh source code JavaScript (mux.js, ws-proxy.js, entrypoint.sh) ke container
COPY . .

# Install dependencies Node.js
RUN npm init -y && npm install ws 2>/dev/null || true

RUN mkdir -p /var/run/sshd /var/run/stunnel4 /etc/stunnel

# Siapkan entrypoint
RUN cp entrypoint.sh /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 8080
EXPOSE 8081

ENTRYPOINT ["/entrypoint.sh"]
