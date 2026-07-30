const net = require('net');
const crypto = require('crypto');

const WS_PORT = process.env.WS_PORT || '8880';
const SSH_TARGET = 22;
const WSMagic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const server = net.createServer((clientConn) => {
    clientConn.setNoDelay(true);

    clientConn.once('data', (data) => {
        const reqStr = data.toString('utf8');
        
        // Cek Jabat Tangan WebSocket
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

        // Hubungkan ke Dropbear internal
        const sshConn = net.createConnection({ port: SSH_TARGET, host: '127.0.0.1' }, () => {
            sshConn.setNoDelay(true);

            // Filter Banner SSH- dari sisa payload suntikan VPN
            let filtering = true;
            let totalRead = 0;

            clientConn.on('data', (chunk) => {
                totalRead += chunk.length;
                if (filtering) {
                    const idx = chunk.indexOf('SSH-');
                    if (idx !== -1) {
                        sshConn.write(chunk.slice(idx));
                        filtering = false;
                    } else if (totalRead > 4096) {
                        sshConn.write(chunk);
                        filtering = false;
                    }
                } else {
                    sshConn.write(chunk);
                }
            });

            sshConn.pipe(clientConn);
        });

        sshConn.on('error', () => clientConn.destroy());
        clientConn.on('error', () => sshConn.destroy());
    });
});

server.listen(WS_PORT, '127.0.0.1', () => {
    console.log(`[WS Engine JS] Active on 127.0.0.1:${WS_PORT}`);
});
