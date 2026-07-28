import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Kairos Brain Server is running!\n');
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  console.log(`[WS] Dispositivo ESP32 connesso con successo da: ${req.socket.remoteAddress}`);

  let audioBuffer = [];

  ws.on('message', (message, isBinary) => {
    if (isBinary) {
      // Accumuliamo i blocchi binari dell'audio in arrivo dall'ESP32
      audioBuffer.push(message);
    } else {
      try {
        const data = JSON.parse(message.toString());
        console.log('[WS] Ricevuto JSON di stato:', data);

        // Quando l'ESP32 segnala che ha finito di inviare ed è in "processing"
        if (data.state === 'processing') {
          console.log(`[WS] Elaborazione audio completata. Totale chunk ricevuti: ${audioBuffer.length}`);
          
          // Inseriamo il campo "action" atteso dal firmware dell'ESP32
          const responsePayload = JSON.stringify({
            action: 'speak',
            state: 'idle',
            text: 'Audio ricevuto con successo dal server Kairós!'
          });
          
          ws.send(responsePayload);
          
          // Svuotiamo il buffer per la prossima sessione
          audioBuffer = [];
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
    console.error('[WS] Errore WebSocket:', error);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server in ascolto sulla porta ${PORT}`);
});
