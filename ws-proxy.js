const net = require('net');
const crypto = require('crypto');

const WS_PORT = process.env.WS_PORT || '8880';
const SSH_TARGET = 22;
const WSMagic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const server = net.createServer((clientConn) => {
    clientConn.setNoDelay(true);

    let isHandshaked = false;
    let headerBuffer = Buffer.alloc(0);

    const handleRawData = (chunk) => {
        if (!isHandshaked) {
            headerBuffer = Buffer.concat([headerBuffer, chunk]);
            const reqStr = headerBuffer.toString('utf8');

            if (reqStr.includes('\r\n\r\n')) {
                isHandshaked = true;
                clientConn.removeListener('data', handleRawData);

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
                connectToDropbear(clientConn, headerBuffer);
            } else if (headerBuffer.length > 65536) {
                clientConn.destroy();
            }
        }
    };

    clientConn.on('data', handleRawData);
});

function connectToDropbear(clientConn, fullHeaderBuffer) {
    const sshConn = net.createConnection({ port: SSH_TARGET, host: '127.0.0.1' }, () => {
        sshConn.setNoDelay(true);

        // 🔥 FIX MUTLAK: Cari posisi index 'SSH-' langsung menggunakan method Buffer bawaan Node.js
        // Ini mencari posisi byte murni, dijamin 100% presisi tanpa tertukar panjang karakter string
        const targetBuffer = Buffer.from('SSH-');
        const byteOffset = fullHeaderBuffer.indexOf(targetBuffer);

        if (byteOffset !== -1) {
            const cleanSSHData = fullHeaderBuffer.subarray(byteOffset);
            if (cleanSSHData.length > 0) {
                sshConn.write(cleanSSHData); // Kirim data pembuka SSH suci murni ke dropbear
            }
        }

        // Aliran data dua arah manual tanpa interupsi
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

    sshConn.on('error', () => clientConn.destroy());
    clientConn.on('error', () => sshConn.destroy());
    
    sshConn.on('close', () => clientConn.destroy());
    clientConn.on('close', () => sshConn.destroy());
}

server.listen(WS_PORT, '127.0.0.1', () => {
    console.log(`[WS Engine JS] Active on 127.0.0.1:${WS_PORT}`);
});
