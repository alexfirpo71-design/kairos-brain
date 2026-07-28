import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Kairos Brain Server is running!\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Nuovo dispositivo ESP32 connesso via WebSocket.');

  ws.on('message', (message) => {
    // Qui gestisci i pacchetti binari audio e l'interazione con Groq
    console.log('Ricevuto messaggio dall ESP32');
  });

  ws.on('close', () => {
    console.log('Dispositivo disconnesso.');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server in ascolto sulla porta ${PORT}`);
});
