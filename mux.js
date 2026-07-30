const net = require('net');

const PUBLIC_PORT = process.env.PORT || '8080';
const SSL_TARGET = parseInt(process.env.SSL_TARGET_PORT || '2443');
const WS_TARGET = parseInt(process.env.WS_TARGET_PORT || '8880');
const SSH_TARGET = 22;

const server = net.createServer((clientConn) => {
    clientConn.setNoDelay(true);
    
    // Pelindung awal jika client putus mendadak saat nego awal
    clientConn.on('error', (err) => {
        console.log(`[Mux] Client Early Error: ${err.message}`);
    });

    let isRouted = false;

    // Gunakan .on('data') biasa agar semua chunk split tertampung
    const handleInitialData = (buffer) => {
        if (isRouted) return;
        
        if (buffer.length > 0) {
            isRouted = true;
            clientConn.removeListener('data', handleInitialData); // Lepas agar tidak double trigger

            let targetPort = WS_TARGET;
            let label = "WS-Proxy / Payload";

            // Deteksi tipe lalu lintas data
            if (buffer[0] === 0x16) {
                targetPort = SSL_TARGET;
                label = "SSL/Stunnel (SNI)";
            } else if (buffer.toString('utf8', 0, 4) === 'SSH-') {
                targetPort = SSH_TARGET;
                label = "Raw Dropbear (Port 22)";
            }

            console.log(`[Mux] Mengalihkan koneksi ke ${label} pada port ${targetPort}`);

            const backendConn = net.createConnection({ port: targetPort, host: '127.0.0.1' }, () => {
                backendConn.setNoDelay(true);
                
                // Kirim buffer pertama secara utuh tanpa ada byte yang hilang
                backendConn.write(buffer);
                
                // Buat aliran data manual dua arah langsung aktif secara transparan
                clientConn.on('data', (data) => {
                    if (backendConn.writable) backendConn.write(data);
                });

                backendConn.on('data', (data) => {
                    if (clientConn.writable) clientConn.write(data);
                });
            });

            // Manajemen penutupan socket agar sinkron dan bersih
            backendConn.on('error', (err) => {
                console.log(`[Mux] Backend Error: ${err.message}`);
                clientConn.destroy();
            });

            clientConn.on('error', (err) => {
                console.log(`[Mux] Client Stream Error: ${err.message}`);
                backendConn.destroy();
            });
            
            backendConn.on('close', () => clientConn.destroy());
            clientConn.on('close', () => backendConn.destroy());
        }
    };

    clientConn.on('data', handleInitialData);
});

server.listen(PUBLIC_PORT, '0.0.0.0', () => {
    console.log(`[Mux JS] Running on port ${PUBLIC_PORT} -> SSL:${SSL_TARGET} | WS:${WS_TARGET}`);
});
