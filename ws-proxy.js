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
            // Kumpulkan potongan data payload (anti-split)
            headerBuffer = Buffer.concat([headerBuffer, chunk]);
            const reqStr = headerBuffer.toString('utf8');

            // Cek apakah payload HTTP dari HP sudah lengkap (double CRLF)
            if (reqStr.includes('\r\n\r\n')) {
                isHandshaked = true;
                clientConn.removeListener('data', handleRawData); // Cabut listener pencatat header

                // Ambil Sec-WebSocket-Key jika ada, kalau tidak ada buat key random
                const keyRegex = /sec-websocket-key:\s*(.*)\r?\n/i;
                const match = reqStr.match(keyRegex);
                let wsKey = match ? match[1].trim() : crypto.randomBytes(16).toString('base64');

                const shasum = crypto.createHash('sha1');
                shasum.update(wsKey + WSMagic);
                const acceptKey = shasum.digest('base64');

                // 🔥 PERBAIKAN FATAL: Kirim respon HTTP 101 yang SANGAT LENGKAP agar DarkTunnel tidak memutus koneksi
                const response = "HTTP/1.1 101 Switching Protocols\r\n" +
                                 "Upgrade: websocket\r\n" +
                                 "Connection: Upgrade\r\n" +
                                 "Sec-WebSocket-Accept: " + acceptKey + "\r\n\r\n";
                
                clientConn.write(response);

                // Hubungkan langsung ke Dropbear internal port 22
                connectToDropbear(clientConn, headerBuffer);
            } else if (headerBuffer.length > 65536) {
                // Batas aman pelindung memori
                clientConn.destroy();
            }
        }
    };

    clientConn.on('data', handleRawData);
});

// 🔥 CORE FILTER FLOW: Memotong sampah payload dan mengalirkan data enkripsi
function connectToDropbear(clientConn, fullHeaderBuffer) {
    const sshConn = net.createConnection({ port: SSH_TARGET, host: '127.0.0.1' }, () => {
        sshConn.setNoDelay(true);

        // Cari string 'SSH-' di dalam tumpukan payload
        const reqStr = fullHeaderBuffer.toString('utf8');
        const idxStr = reqStr.indexOf('SSH-');

        if (idxStr !== -1) {
            const byteOffset = fullHeaderBuffer.toString('utf8', 0, idxStr).length;
            const cleanSSHData = fullHeaderBuffer.slice(byteOffset);
            
            if (cleanSSHData.length > 0) {
                sshConn.write(cleanSSHData); // Kirim data SSH bersih pertama ke Dropbear
            }
        }

        // Jalankan pertukaran data dua arah secara realtime
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

    // Bersihkan socket jika koneksi berakhir
    sshConn.on('error', () => clientConn.destroy());
    clientConn.on('error', () => sshConn.destroy());
    
    sshConn.on('close', () => clientConn.destroy());
    clientConn.on('close', () => sshConn.destroy());
}

server.listen(WS_PORT, '127.0.0.1', () => {
    console.log(`[WS Engine JS] Active on 127.0.0.1:${WS_PORT}`);
});
