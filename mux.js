const net = require('net');

const PUBLIC_PORT = process.env.PORT || '8080';
const SSL_TARGET = parseInt(process.env.SSL_TARGET_PORT || '2443');
const WS_TARGET = parseInt(process.env.WS_TARGET_PORT || '8880');
const SSH_TARGET = 22;

const server = net.createServer((clientConn) => {
    clientConn.setNoDelay(true);

    const handleInitialData = (buffer) => {
        if (buffer.length > 0) {
            clientConn.removeListener('data', handleInitialData);

            let targetPort = WS_TARGET;

            if (buffer[0] === 0x16) {
                targetPort = SSL_TARGET;
            } else if (buffer.toString('utf8', 0, 4) === 'SSH-') {
                targetPort = SSH_TARGET;
            }

            const backendConn = net.createConnection({ port: targetPort, host: '127.0.0.1' }, () => {
                backendConn.setNoDelay(true);
                backendConn.write(buffer);

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

            backendConn.on('error', () => clientConn.destroy());
            clientConn.on('error', () => backendConn.destroy());
            backendConn.on('close', () => clientConn.destroy());
            clientConn.on('close', () => backendConn.destroy());
        }
    };

    clientConn.on('data', handleInitialData);
});

server.listen(PUBLIC_PORT, '0.0.0.0', () => {
    console.log(`[Mux JS] Back to Original Clean Logic on Port ${PUBLIC_PORT}`);
});
