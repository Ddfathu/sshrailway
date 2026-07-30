const net = require('net');
const crypto = require('crypto');

const WS_PORT = process.env.WS_PORT || '8880';
const SSH_TARGET = 22;
const WSMagic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const server = net.createServer((clientConn) => {
    clientConn.setNoDelay(true);

    let isHandshaked = false;
    let headerBuffer = Buffer.alloc(0);

    // Fungsi utama membaca data dari aplikasi VPN di HP
    const handleRawData = (chunk) => {
        if (!isHandshaked) {
            // Kumpulkan data potongan payload jika terpecah (anti-split payload panjang)
            headerBuffer = Buffer.concat([headerBuffer, chunk]);
            const reqStr = headerBuffer.toString('utf8');

            // Cek apakah payload HTTP sudah lengkap (ditandai dengan double CRLF)
            if (reqStr.includes('\r\n\r\n')) {
                isHandshaked = true;
                clientConn.removeListener('data', handleRawData); // Cabut listener awal

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

                // Setelah sukses 101, hubungkan ke Dropbear internal
                connectToDropbear(clientConn, headerBuffer);
            } else if (headerBuffer.length > 65536) {
                // Keamanan: Jika sampah payload kepanjangan banget (>64KB) dan gak kelar-kelar, putuskan!
                clientConn.destroy();
            }
        }
    };

    clientConn.on('data', handleRawData);
});

// 🔥 CORE FILTER: Memotong sampah payload dan hanya menyisakan data SSH murni
function connectToDropbear(clientConn, fullHeaderBuffer) {
    const sshConn = net.createConnection({ port: SSH_TARGET, host: '127.0.0.1' }, () => {
        sshConn.setNoDelay(true);

        // Cari di mana letak awal string 'SSH-' di dalam tumpukan payload raksasa
        const reqStr = fullHeaderBuffer.toString('utf8');
        const idxStr = reqStr.indexOf('SSH-');

        if (idxStr !== -1) {
            // Ubah kembali index string ke posisi byte Buffer asli
            const byteOffset = fullHeaderBuffer.toString('utf8', 0, idxStr).length;
            const cleanSSHData = fullHeaderBuffer.slice(byteOffset);
            
            if (cleanSSHData.length > 0) {
                sshConn.write(cleanSSHData); // Kirim data bersih ke Dropbear
            }
        }

        // Jalankan pipe murni secara dua arah (Loss tanpa double listener yang bikin crash)
        clientConn.pipe(sshConn);
        sshConn.pipe(clientConn);
    });

    sshConn.on('error', () => clientConn.destroy());
    clientConn.on('error', () => sshConn.destroy());
    clientConn.on('close', () => clientConn.destroy());
    clientConn.on('end', () => clientConn.end());
    
    clientConn.on('close', () => sshConn.destroy());
    clientConn.on('end', () => sshConn.end());
}

server.listen(WS_PORT, '127.0.0.1', () => {
    console.log(`[WS Engine JS] Active on 127.0.0.1:${WS_PORT}`);
});
