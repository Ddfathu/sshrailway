const net = require('net');
const crypto = require('crypto');

const WS_PORT = process.env.WS_PORT || '8880';
const SSH_TARGET_HOST = '127.0.0.1';
const SSH_TARGET_PORT = 22;
const WSMagic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Fungsi pembantu untuk memparsing header seperti Python
function parseHeaders(rawText) {
    const headers = {};
    const lines = rawText.split("\r\n");
    for (let i = 1; i < lines.length; i++) {
        let line = lines[i];
        if (line.includes(":")) {
            let parts = line.split(":");
            let k = parts[0].trim().toLowerCase();
            let v = parts.slice(1).join(":").trim();
            headers[k] = v;
        }
    }
    return headers;
}

const server = net.createServer((clientConn) => {
    clientConn.setNoDelay(true);

    clientConn.once('data', (rawHeaders) => {
        if (!rawHeaders || rawHeaders.length === 0) {
            clientConn.destroy();
            return;
        }

        const rawText = rawHeaders.toString('utf8');
        const rawTextLower = rawText.toLowerCase();
        const headers = parseHeaders(rawText);

        const isWsUpgrade = rawTextLower.includes('upgrade: websocket') || headers['upgrade'] === 'websocket';

        if (isWsUpgrade) {
            // Cari WebSocket Key
            let wsKey = headers['sec-websocket-key'];
            if (!wsKey && rawTextLower.includes('sec-websocket-key:')) {
                const lines = rawText.split("\r\n");
                for (let line of lines) {
                    if (line.toLowerCase().startsWith('sec-websocket-key:')) {
                        wsKey = line.split(":")[1].trim();
                        break;
                    }
                }
            }

            if (!wsKey) {
                wsKey = crypto.randomBytes(16).toString('base64');
            }

            const shasum = crypto.createHash('sha1');
            shasum.update(wsKey + WSMagic);
            const acceptKey = shasum.digest('base64');

            // Susun respon HTTP 101 sakti
            let response = "HTTP/1.1 101 Switching Protocols\r\n" +
                             "Upgrade: websocket\r\n" +
                             "Connection: Upgrade\r\n" +
                             `Sec-WebSocket-Accept: ${acceptKey}\r\n`;
            
            // 🔥 KUNCI UTAMA: Kembalikan protokol WebSocket jika diminta oleh DarkTunnel
            if (headers['sec-websocket-protocol']) {
                response += `Sec-WebSocket-Protocol: ${headers['sec-websocket-protocol']}\r\n`;
            }
            response += "\r\n";
            
            clientConn.write(response);
        } else {
            // Default response bawaan env
            const defaultResp = process.env.WS_RESPONSE || "HTTP/1.1 101 Switching Protocols\r\n\r\n";
            clientConn.write(defaultResp);
        }

        // TEPAT SETELAH 101 DIKIRIM: Buka koneksi ke Dropbear (Persis alur Python)
        const sshConn = net.createConnection({ port: SSH_TARGET_PORT, host: SSH_TARGET_HOST }, () => {
            sshConn.setNoDelay(true);

            let firstPacket = true;

            // Alirkan data dari HP (Client) ke Dropbear dengan filter badak Python
            clientConn.on('data', (data) => {
                if (firstPacket) {
                    firstPacket = false;
                    const dataStr = data.toString('utf8');
                    
                    // Cek jika paket awal setelah 101 membawa ampas teks PATCH/HTTP mentah
                    if (dataStr.includes('PATCH') || dataStr.includes('HTTP/')) {
                        if (dataStr.includes('SSH-')) {
                            const idx = data.indexOf('SSH-');
                            data = data.subarray(idx); // Potong, sisakan data SSH murni
                        } else {
                            return; // Buang data sampah mentah, tunggu paket selanjutnya
                        }
                    }
                }

                if (sshConn.writable) {
                    sshConn.write(data);
                }
            });

            // Alirkan balik dari Dropbear ke HP secara loss
            sshConn.on('data', (data) => {
                if (clientConn.writable) {
                    clientConn.write(data);
                }
            });
        });

        // Error & Close handling agar tidak zombie
        sshConn.on('error', () => clientConn.destroy());
        clientConn.on('error', () => sshConn.destroy());
        sshConn.on('close', () => clientConn.destroy());
        clientConn.on('close', () => sshConn.destroy());
    });
});

server.listen(WS_PORT, '0.0.0.0', () => {
    console.log(`[WS Engine JS] Active on 0.0.0.0:${WS_PORT} -> Matching Dropbear Python Logic`);
});
