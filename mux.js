const net = require('net');

const PUBLIC_PORT = process.env.PORT || '8080';
const SSL_TARGET = parseInt(process.env.SSL_TARGET_PORT || '2443');
const WS_TARGET = parseInt(process.env.WS_TARGET_PORT || '8880');
const SSH_TARGET = 22;

const server = net.createServer((clientConn) => {
    // 🚀 Loss tanpa delay, langsung bypass socket
    clientConn.setNoDelay(true);

    let isRouted = false;

    const handleInitialData = (buffer) => {
        if (isRouted) return;
        
        if (buffer.length > 0) {
            isRouted = true;
            clientConn.removeListener('data', handleInitialData);

            let targetPort = WS_TARGET;

            // Filter byte awal jabat tangan bawaan lu
            if (buffer[0] === 0x16) {
                targetPort = SSL_TARGET;
            } else if (buffer.toString('utf8', 0, 4) === 'SSH-') {
                targetPort = SSH_TARGET;
            }

            // Tembak langsung ke target internal port dengan mode manual kilat
            const backendConn = net.createConnection({ 
                port: targetPort, 
                host: '127.0.0.1' 
            }, () => {
                backendConn.setNoDelay(true);
                
                // Tulis paket jabat tangan pertama
                backendConn.write(buffer);

                // 🔥 BALIK KE MODE LOSS MANUAL (Tanpa pipa rem otomatis)
                clientConn.on('data', (data) => {
                    if (backendConn.writable) {
                        backendConn.write(data);
                    }
                });

                backendConn.on('data', (data) => {
                    if (clientConn.writable) {
                        clientConn.write(data);
                    }
                });
            });

            // Manajemen error biar tetep aman ga zombie
            backendConn.on('error', () => clientConn.destroy());
            clientConn.on('error', () => backendConn.destroy());
            backendConn.on('close', () => clientConn.destroy());
            clientConn.on('close', () => backendConn.destroy());
        }
    };

    clientConn.on('data', handleInitialData);
});

server.listen(PUBLIC_PORT, '0.0.0.0', () => {
    console.log(`[Mux JS] Raw Express Loss Engine Active on Port ${PUBLIC_PORT}`);
});
