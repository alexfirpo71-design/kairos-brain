import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Kairos Brain Server is running!\n');
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  console.log(`[WS] Dispositivo ESP32 connesso con successo da: ${req.socket.remoteAddress}`);

  ws.on('message', (message, isBinary) => {
    if (isBinary) {
      console.log(`[WS] Ricevuto pacchetto audio binario (${message.length} bytes)`);
    } else {
      try {
        const data = JSON.parse(message.toString());
        console.log('[WS] Ricevuto JSON:', data);

        // Se l'ESP32 segnala la fine della registrazione o elaborazione, rispondiamo
        if (data.state === 'processing' || data.state === 'listening') {
          // Inviamo una risposta JSON di riscontro al client ESP32
          const responsePayload = JSON.stringify({
            type: 'tts',
            state: 'playing',
            text: 'Ho ricevuto il tuo messaggio audio correttamente.'
          });
          ws.send(responsePayload);
        }
      } catch (e) {
        console.log('[WS] Messaggio di testo ricevuto:', message.toString());
      }
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] Disconnesso. Codice: ${code}, Motivo: ${reason.toString()}`);
  });

  ws.on('error', (error) => {
    console.error('[WS] Errore:', error);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server in ascolto sulla porta ${PORT}`);
});
