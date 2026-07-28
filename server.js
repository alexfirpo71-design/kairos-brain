import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Kairos Brain Server is running!\n');
});

const wss = new WebSocketServer({ server, path: '/ws' });

// Funzione per inviare l'audio a Groq Whisper API
async function transcribeAudio(audioBuffer) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY non configurata nelle variabili d'ambiente di Render.");
  }

  const formData = new FormData();
  formData.append('file', audioBuffer, {
    filename: 'audio.wav',
    contentType: 'audio/wav',
  });
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'it');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      ...formData.getHeaders()
    },
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Errore API Groq Whisper: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.text;
}

// Funzione per interrogare il modello LLM di Groq con il testo trascritto
async function getGroqChatResponse(userText) {
  const apiKey = process.env.GROQ_API_KEY;
  
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'Sei Kairós, un assistente IA vocale conciso, amichevole e utile.' },
        { role: 'user', content: userText }
      ],
      max_tokens: 150
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Errore API Groq Chat: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

wss.on('connection', (ws, req) => {
  console.log(`[WS] Dispositivo ESP32 connesso con successo da: ${req.socket.remoteAddress}`);

  let audioBuffer = [];

  ws.on('message', async (message, isBinary) => {
    if (isBinary) {
      audioBuffer.push(message);
    } else {
      try {
        const data = JSON.parse(message.toString());
        console.log('[WS] Ricevuto JSON di stato:', data);

        if (data.state === 'processing') {
          const totalBytes = audioBuffer.reduce((acc, chunk) => acc + chunk.length, 0);
          console.log(`[WS] Elaborazione audio completata. Chunk: ${audioBuffer.length}, Byte: ${totalBytes}`);
          
          const completeAudioBuffer = Buffer.concat(audioBuffer);

          let replyText = "Ricevuto.";
          try {
            // 1. Trascriviamo l'audio con Whisper
            console.log("[Groq] Invio audio a Whisper...");
            const transcript = await transcribeAudio(completeAudioBuffer);
            console.log(`[Groq] Trascrizione: "${transcript}"`);

            if (transcript && transcript.trim().length > 0) {
              // 2. Chiediamo la risposta all'LLM
              console.log("[Groq] Generazione risposta LLM...");
              replyText = await getGroqChatResponse(transcript);
              console.log(`[Groq] Risposta LLM: "${replyText}"`);
            } else {
              replyText = "Non ho udito alcun messaggio chiaro.";
            }
          } catch (apiError) {
            console.error("[Groq] Errore durante l'elaborazione IA:", apiError);
            replyText = "Errore di elaborazione sul server Kairós.";
          }

          // Inviamo la risposta testuale all'ESP32
          const responsePayload = JSON.stringify({
            action: 'speak',
            state: 'idle',
            text: replyText
          });
          
          ws.send(responsePayload);
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
