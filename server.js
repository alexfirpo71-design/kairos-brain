const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = createServer(app);

// Configurazione corretta del WebSocket Server che intercetta il percorso /ws
const wss = new WebSocketServer({ server, path: '/ws' });

app.get('/', (req, res) => {
    res.send('Kairós Brain Server is online!');
});

wss.on('connection', (ws, req) => {
    console.log(`[WS] Dispositivo connesso da IP: ${req.socket.remoteAddress}`);

    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            // Qui ricevi l'audio binario dall'ESP32 (VAD o Pulsante)
            console.log(`[WS] Ricevuti ${message.length} bytes di audio binario.`);
            
            // Esempio di risposta fittizia o inoltro a Groq/TTS
            // ws.send(bufferAudioDiRisposta);
        } else {
            try {
                const data = JSON.parse(message.toString());
                console.log('[WS] Messaggio JSON ricevuto:', data);
                
                if (data.state === 'listening') {
                    console.log('[Kairós] Stato: In ascolto...');
                }
            } catch (e) {
                console.log('[WS] Messaggio di testo grezzo:', message.toString());
            }
        }
    });

    ws.on('close', () => {
        console.log('[WS] Connessione chiusa dal client.');
    });

    ws.on('error', (error) => {
        console.error('[WS Errore]:', error);
    });
});

// Fondamentale: usa SEMPRE process.env.PORT per Render
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`==> Server Kairós avviato e in ascolto sulla porta ${PORT}`);
});
