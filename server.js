import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Kairos Brain Server is running!\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  console.log(`[WS] Nuovo dispositivo ESP32 connesso dall'IP: ${req.socket.remoteAddress}`);

  ws.on('message', (message) => {
    console.log('[WS] Ricevuto pacchetto dall ESP32');
    // Qui in seguito integreremo la gestione dei dati audio e di Groq
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] Dispositivo disconnesso. Codice: ${code}, Motivo: ${reason.toString()}`);
  });

  ws.on('error', (error) => {
    console.error('[WS] Errore sulla connessione:', error);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server in ascolto sulla porta ${PORT}`);
});
