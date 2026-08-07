const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = createServer(app);

// Inizializzazione WebSocket sul percorso /ws richiesto dall'ESP32
const wss = new WebSocketServer({ server, path: '/ws' });

app.get('/', (req, res) => {
    res.send('Kairós Brain Server is online!');
});

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[WS] Dispositivo connesso da IP: ${ip}`);

    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            // Logica ricezione audio binario
            console.log(`[WS] Ricevuti ${message.length} bytes di audio.`);
        } else {
            try {
                const data = JSON.parse(message.toString());
                console.log('[WS] Messaggio JSON ricevuto:', data);
                
                if (data.state === 'listening') {
                    console.log('[Kairós] Stato: In ascolto...');
                }
            } catch (e) {
                console.log('[WS] Messaggio di testo:', message.toString());
            }
        }
    });

    ws.on('close', () => console.log('[WS] Connessione chiusa.'));
    ws.on('error', (err) => console.error('[WS Errore]:', err));
});

// Porta dinamica per Render, bind su 0.0.0.0 obbligatorio
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`==> Server Kairós avviato e in ascolto sulla porta ${PORT}`);
});
