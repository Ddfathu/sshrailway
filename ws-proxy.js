const net = require('net');
const crypto = require('crypto');

const WS_PORT = process.env.WS_PORT || '8880';
const SSH_TARGET = 22;
const WSMagic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const server = net.createServer((clientConn) => {
    clientConn.setNoDelay(true);

    let isHandshaked = false;
    let headerBuffer = Buffer.alloc(0);

    // Fungsi utama membaca data payload dari aplikasi VPN di HP
    const handleRawData = (chunk) => {
        if (!isHandshaked) {
            // Kumpulkan potongan data jika payload di-split oleh operator/aplikasi
            headerBuffer = Buffer.concat([headerBuffer, chunk]);
            const reqStr = headerBuffer.toString('utf8');

            // Cek apakah payload HTTP sudah lengkap (ditandai dengan double CRLF)
            if (reqStr.includes('\r\n\r\n')) {
                isHandshaked = true;
                clientConn.removeListener('data', handleRawData); // Cabut listener pencatat header

                // Proses Jabat Tangan WebSocket
                if (reqStr.toLowerCase().includes('upgrade: websocket') || reqStr.toLowerCase().includes('websocket')) {
                    const keyRegex = /sec-websocket-key:\s*(.*)\r?\n/i;
                    const match = reqStr.match(keyRegex);
                    let wsKey = match ? match[1].trim() : crypto.randomBytes(16).toString('base64');

                    const shasum = crypto.createHash('sha1');
                    shasum.update(wsKey + WSMagic);
                    const acceptKey = shasum.digest('base64');

                    const response = "HTTP/1.1 101 Switching Protocols\r\n" +
                                     "Upgrade: websocket\r\n" +
                                     "Connection: Upgrade\r\n" +
                                     "Sec-WebSocket-Accept: " + acceptKey + "\r\n\r\n";
                    clientConn.write(response);
                } else {
                    clientConn.write("HTTP/1.1 101 Switching Protocols\r\n\r\n");
                }

                // Setelah sukses merespon 101, hubungkan langsung ke Dropbear internal
                connectToDropbear(clientConn, headerBuffer);
            } else if (headerBuffer.length > 65536) {
                // Keamanan: Jika payload sampah kepanjangan banget (>64KB) putuskan rute
                clientConn.destroy();
            }
        }
    };

    clientConn.on('data', handleRawData);
});

// 🔥 CORE FILTER & STREAMING MANUAL ANTI-CLOSED
function connectToDropbear(clientConn, fullHeaderBuffer) {
    const sshConn = net.createConnection({ port: SSH_TARGET, host: '127.0.0.1' }, () => {
        sshConn.setNoDelay(true);

        // 1. Cari & bersihkan seluruh sampah teks payload raksasa
        const reqStr = fullHeaderBuffer.toString('utf8');
        const idxStr = reqStr.indexOf('SSH-');

        if (idxStr !== -1) {
            // Ubah index karakter menjadi byte offset asli
            const byteOffset = fullHeaderBuffer.toString('utf8', 0, idxStr).length;
            const cleanSSHData = fullHeaderBuffer.slice(byteOffset);
            
            if (cleanSSHData.length > 0) {
                sshConn.write(cleanSSHData); // Kirim paket inisiasi SSH yang bersih ke Dropbear
            }
        }

        // 2. KUNCI UNTUK MENTOK BANNER: Aliran data manual dua arah tanpa interupsi
        clientConn.on('data', (data) => {
            if (sshConn.writable) {
                sshConn.write(data);
            }
        });

        sshConn.on('data', (data) => {
            if (clientConn.writable) {
                clientConn.write(data);
            }
        });
    });

    // Manajemen penutupan socket agar bersih tidak meninggalkan zombie proses
    sshConn.on('error', () => clientConn.destroy());
    clientConn.on('error', () => sshConn.destroy());
    
    sshConn.on('close', () => clientConn.destroy());
    clientConn.on('close', () => sshConn.destroy());
}

server.listen(WS_PORT, '127.0.0.1', () => {
    console.log(`[WS Engine JS] Active on 127.0.0.1:${WS_PORT}`);
});
