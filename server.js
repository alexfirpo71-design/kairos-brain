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
          const totalBytes = audioBuffer.reduce((acc, chunk) => acc + chunk.length, 0);
          console.log(`[WS] Elaborazione audio completata. Chunk ricevuti: ${audioBuffer.length}, Totale byte: ${totalBytes}`);
          
          // Uniamo tutti i chunk binari in un unico Buffer audio completo
          const completeAudioBuffer = Buffer.concat(audioBuffer);

          // TODO: Qui puoi inviare 'completeAudioBuffer' alle API di Groq o Whisper per la trascrizione
          // const aiResponseText = await callGroqAPI(completeAudioBuffer);

          // Per adesso rispondiamo simulando l'elaborazione dell'IA
          const responsePayload = JSON.stringify({
            action: 'speak',
            state: 'idle',
            text: `Ho elaborato ${totalBytes} bytes di audio con successo!`
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
