const net = require('net');

const PUBLIC_PORT = process.env.PORT || '8080';
const SSL_TARGET = parseInt(process.env.SSL_TARGET_PORT || '2443');
const WS_TARGET = parseInt(process.env.WS_TARGET_PORT || '8880');
const SSH_TARGET = 22;

const server = net.createServer((clientConn) => {
    // 🚀 AKTIFKAN HILANGKAN DELAY PAKET (KILAT)
    clientConn.setNoDelay(true);
    
    // Set ukuran alokasi buffer pembacaan internal menjadi 64KB (Default cuma 16KB)
    clientConn.readableHighWaterMark = 64 * 1024;
    clientConn.writableHighWaterMark = 64 * 1024;

    let isRouted = false;

    // Proteksi timeout awal 3 detik agar socket mati tidak menggantung
    const handshakeTimeout = setTimeout(() => {
        if (!isRouted) {
            clientConn.destroy();
        }
    }, 3000);

    const handleInitialData = (buffer) => {
        if (isRouted) return;
        
        if (buffer.length > 0) {
            isRouted = true;
            clearTimeout(handshakeTimeout);
            clientConn.removeListener('data', handleInitialData);

            let targetPort = WS_TARGET;

            if (buffer[0] === 0x16) {
                targetPort = SSL_TARGET;
            } else if (buffer.toString('utf8', 0, 4) === 'SSH-') {
                targetPort = SSH_TARGET;
            }

            // Koneksi ke backend target dengan optimasi buffer raksasa
            const backendConn = net.createConnection({ 
                port: targetPort, 
                host: '127.0.0.1',
                readableHighWaterMark: 64 * 1024,
                writableHighWaterMark: 64 * 1024
            }, () => {
                backendConn.setNoDelay(true);
                
                // Kirim byte jabat tangan awal
                backendConn.write(buffer);
                
                // 🔥 KUNCI UTAMA: Menggunakan fungsi .pipe bawaan Node.JS + anti-backpressure
                // Ini otomatis ngerem & ngedorong data sesuai bandwidth asli biar container gak choking/rekonek
                clientConn.pipe(backendConn);
                backendConn.pipe(clientConn);
            });

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
