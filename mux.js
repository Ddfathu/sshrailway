const net = require('net');

const PUBLIC_PORT = process.env.PORT || '8080';
const SSL_TARGET = parseInt(process.env.SSL_TARGET_PORT || '2443');
const WS_TARGET = parseInt(process.env.WS_TARGET_PORT || '8880');
const SSH_TARGET = 22;

const server = net.createServer((clientConn) => {
    // 🚀 Jalur bebas hambatan tanpa delay
    clientConn.setNoDelay(true);
    
    // Alokasi memori buffer raksasa 64KB agar tidak macet saat speedtest
    clientConn.readableHighWaterMark = 64 * 1024;
    clientConn.writableHighWaterMark = 64 * 1024;

    let isRouted = false;

    const handleInitialData = (buffer) => {
        if (isRouted) return;
        
        if (buffer.length > 0) {
            isRouted = true;
            clientConn.removeListener('data', handleInitialData);

            let targetPort = WS_TARGET;

            // Filter byte awal jabat tangan
            if (buffer[0] === 0x16) {
                targetPort = SSL_TARGET;
            } else if (buffer.toString('utf8', 0, 4) === 'SSH-') {
                targetPort = SSH_TARGET;
            }

            // Tembak langsung ke target internal port
            const backendConn = net.createConnection({ 
                port: targetPort, 
                host: '127.0.0.1',
                readableHighWaterMark: 64 * 1024,
                writableHighWaterMark: 64 * 1024
            }, () => {
                backendConn.setNoDelay(true);
                
                // Tulis data pembuka
                backendConn.write(buffer);
                
                // 🔥 Pipe otomatis dua arah bawaan core Node.js (Anti-Rekonek)
                clientConn.pipe(backendConn);
                backendConn.pipe(clientConn);
            });

            // Manajemen error transparan biar gak crash
            backendConn.on('error', () => clientConn.destroy());
            clientConn.on('error', () => backendConn.destroy());
            backendConn.on('close', () => clientConn.destroy());
            clientConn.on('close', () => backendConn.destroy());
        }
    };

    clientConn.on('data', handleInitialData);
});

server.listen(PUBLIC_PORT, '0.0.0.0', () => {
    console.log(`[Mux JS] Turbo Speed Engine Active on Port ${PUBLIC_PORT}`);
});
