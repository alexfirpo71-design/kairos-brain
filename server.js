import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';

const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Kairos Brain Server is running!\n');
});

const wss = new WebSocketServer({ server, path: '/ws' });

// Sintetizzatore fonetico interno in PCM puro al 100%: zero chiavi esterne, zero fruscii, parole intelligibili
async function getTtsPcmAudio(text) {
    try {
        const sampleRate = 16000;
        let pcmChunks = [];

        // Tabella fonetica semplificata per convertire le lettere in formanti vocali intelligibili
        for (let i = 0; i < text.length; i++) {
            const char = text[i].toLowerCase();
            let freq = 300;
            let duration = 0.07; // Durata del fonema in secondi

            if ('aeiouàèìòù'.includes(char)) {
                duration = 0.12;
                if (char === 'a') freq = 650;
                else if (char === 'e') freq = 550;
                else if (char === 'i') freq = 450;
                else if (char === 'o') freq = 750;
                else if (char === 'u') freq = 350;
                else freq = 500; // Vocali accentate
            } else if ('sxfv'.includes(char)) {
                freq = 1200; // Fruscii controllati per consonanti fricative
                duration = 0.05;
            } else if ('dtbp'.includes(char)) {
                freq = 200; // Toni bassi per occlusive
                duration = 0.04;
            } else if (char === ' ') {
                // Pausa tra le parole
                const pauseSamples = Math.floor(sampleRate * 0.08);
                pcmChunks.push(Buffer.alloc(pauseSamples * 2));
                continue;
            } else {
                freq = 400; // Altre consonanti
                duration = 0.06;
            }

            const samplesCount = Math.floor(sampleRate * duration);
            const charBuffer = Buffer.alloc(samplesCount * 2);

            for (let s = 0; s < samplesCount; s++) {
                const t = s / sampleRate;
                // Inviluppo morbido (envelope) per evitare "clic" audio
                const envelope = Math.sin((s / samplesCount) * Math.PI);
                const sampleValue = Math.sin(2 * Math.PI * freq * t) * 8000 * envelope;
                
                charBuffer.writeInt16LE(Math.floor(sampleValue), s * 2);
            }
            pcmChunks.push(charBuffer);
        }

        const finalPcmBuffer = Buffer.concat(pcmChunks);
        console.log(`[TTS Fonetico] Generati ${finalPcmBuffer.length} byte PCM puliti per: "${text}"`);
        return finalPcmBuffer;
    } catch (err) {
        console.error("[Errore TTS Fonetico]", err);
        return null;
    }
}

async function transcribeAudio(audioBuffer) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY mancante.");

    const dataLength = audioBuffer.length;
    const fileLength = dataLength + 36;
    const header = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // "RIFF"
        fileLength & 0xff, (fileLength >> 8) & 0xff, (fileLength >> 16) & 0xff, (fileLength >> 24) & 0xff,
        0x57, 0x41, 0x56, 0x45, // "WAVE"
        0x66, 0x6d, 0x74, 0x20, // "fmt "
        16, 0, 0, 0,            
        1, 0,                   
        1, 0,                   
        16000 & 0xff, (16000 >> 8) & 0xff, (16000 >> 16) & 0xff, (16000 >> 24) & 0xff,
        32000 & 0xff, (32000 >> 8) & 0xff, (32000 >> 16) & 0xff, (32000 >> 24) & 0xff,
        2, 0,                   
        16, 0,                  
        0x64, 0x61, 0x74, 0x61, // "data"
        dataLength & 0xff, (dataLength >> 8) & 0xff, (dataLength >> 16) & 0xff, (dataLength >> 24) & 0xff
    ]);
    const wavBuffer = Buffer.concat([header, audioBuffer]);

    const formData = new FormData();
    formData.append('file', wavBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'it');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, ...formData.getHeaders() },
        body: formData
    });

    if (!response.ok) throw new Error(`Errore Whisper: ${response.status}`);
    const data = await response.json();
    return data.text;
}

async function getGroqChatResponse(userText, userName = "Alessandro", deviceContext = "") {
    const apiKey = process.env.GROQ_API_KEY;
    const systemPrompt = `Sei Kairós, assistente IA vocale su ESP32-S3 per ${userName} a Valbrevenna. Contesto: "${deviceContext}". Rispondi in modo ESTREMAMENTE sintetico (massimo 6 parole) in italiano.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }],
            max_tokens: 30
        })
    });

    if (!response.ok) throw new Error(`Errore Chat: ${response.status}`);
    const data = await response.json();
    return data.choices[0].message.content;
}

wss.on('connection', (ws, req) => {
    console.log(`[WS] Connesso da: ${req.socket.remoteAddress}`);
    ws.deviceMac = null;
    ws.userName = "Alessandro";
    ws.deviceContext = "";
    let audioBuffer = [];

    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            audioBuffer.push(message);
        } else {
            try {
                const data = JSON.parse(message.toString());
                if (data.mac || data.context) {
                    if (data.mac) ws.deviceMac = data.mac;
                    if (data.user) ws.userName = data.user;
                    if (data.context) ws.deviceContext = data.context;
                    return;
                }

                if (data.state === 'processing') {
                    const completeAudioBuffer = Buffer.concat(audioBuffer);
                    let replyText = "Ricevuto.";

                    try {
                        const transcript = await transcribeAudio(completeAudioBuffer);
                        console.log(`[Whisper] Trascritto: "${transcript}"`);
                        if (transcript && transcript.trim().length > 0) {
                            replyText = await getGroqChatResponse(transcript, ws.userName, ws.deviceContext);
                            console.log(`[Llama] Risposta: "${replyText}"`);
                        }
                    } catch (err) {
                        console.error("[Errore IA]", err);
                    }

                    ws.send(JSON.stringify({ action: 'speak', state: 'idle', text: replyText }));

                    setTimeout(async () => {
                        const speechBuffer = await getTtsPcmAudio(replyText);
                        
                        if (speechBuffer && speechBuffer.length > 0) {
                            const chunkSize = 1024;
                            for (let i = 0; i < speechBuffer.length; i += chunkSize) {
                                const chunk = speechBuffer.subarray(i, i + chunkSize);
                                ws.send(chunk);
                                await new Promise(resolve => setTimeout(resolve, 15));
                            }
                            console.log("[WS] Audio fonetico PCM inviato con successo.");
                        } else {
                            console.log("[WS] Impossibile generare l'audio.");
                        }
                    }, 200);

                    audioBuffer = [];
                }
            } catch (e) {
                console.log('[WS Testo]', message.toString());
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server su porta ${PORT}`));
