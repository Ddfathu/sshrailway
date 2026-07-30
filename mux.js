const net = require('net');

const PUBLIC_PORT = process.env.PORT || '8080';
const SSL_TARGET = parseInt(process.env.SSL_TARGET_PORT || '2443');
const WS_TARGET = parseInt(process.env.WS_TARGET_PORT || '8880');
const SSH_TARGET = 22;

const server = net.createServer((clientConn) => {
    clientConn.setNoDelay(true);
    
    // 🔥 TAMBAHAN UTAMA: Pelindung awal agar Mux gak crash kalau client putus sebelum kirim data
    clientConn.on('error', (err) => {
        // Cukup log pelan atau abaikan biar server gak mati
        console.log(`[Mux] Client Early Error: ${err.message}`);
    });

    // Intip data awal
    clientConn.once('data', (buffer) => {
        let targetPort = WS_TARGET;
        let label = "WS-Proxy / Payload";

        if (buffer.length > 0) {
            if (buffer[0] === 0x16) {
                targetPort = SSL_TARGET;
                label = "SSL/Stunnel (SNI)";
            } else if (buffer.toString('utf8', 0, 4) === 'SSH-') {
                targetPort = SSH_TARGET;
                label = "Raw Dropbear (Port 22)";
            }
        }

        console.log(`[Mux] Mengalihkan koneksi ke ${label} pada port ${targetPort}`);

        const backendConn = net.createConnection({ port: targetPort, host: '127.0.0.1' }, () => {
            backendConn.setNoDelay(true);
            // Kirim kembali data awal yang tadi diintip ke backend
            backendConn.write(buffer);
            
            // Pipe data bolak-balik secara loss
            clientConn.pipe(backendConn);
            backendConn.pipe(clientConn);
        });

        // Bersihkan listener error lama dan ganti dengan penanganan saat terhubung
        clientConn.removeAllListeners('error');

        backendConn.on('error', (err) => {
            console.log(`[Mux] Backend Error: ${err.message}`);
            clientConn.destroy();
        });

        clientConn.on('error', (err) => {
            console.log(`[Mux] Client Stream Error: ${err.message}`);
            backendConn.destroy();
        });
        
        // Pastikan kalau salah satu nutup, pasangannya ikut nutup bersih
        backendConn.on('close', () => clientConn.destroy());
        clientConn.on('close', () => backendConn.destroy());
    });
});

server.listen(PUBLIC_PORT, '0.0.0.0', () => {
    console.log(`[Mux JS] Running on port ${PUBLIC_PORT} -> SSL:${SSL_TARGET} | WS:${WS_TARGET}`);
});
