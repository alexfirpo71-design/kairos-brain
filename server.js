import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { spawn } from 'child_process';

const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Kairos Brain Server is running!\n');
});

const wss = new WebSocketServer({ server, path: '/ws' });

async function getTtsPcmAudio(text) {
    try {
        // Aumentato leggermente il limite caratteri per TTS per gestire risposte un po' più lunghe
        const cleanText = encodeURIComponent(text.substring(0, 300));
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${cleanText}&tl=it&client=tw-ob`;
        
        const response = await fetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        if (!response.ok) throw new Error(`Errore TTS HTTP: ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        const mp3Buffer = Buffer.from(arrayBuffer);

        const pcmBuffer = await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', 'pipe:0',
                '-f', 's16le',
                '-acodec', 'pcm_s16le',
                '-ac', '1',
                '-ar', '16000',
                'pipe:1'
            ]);

            let chunks = [];
            ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
            ffmpeg.on('close', code => {
                if (code === 0) resolve(Buffer.concat(chunks));
                else reject(new Error(`FFmpeg exited with code ${code}`));
            });
            ffmpeg.on('error', err => reject(err));

            ffmpeg.stdin.write(mp3Buffer);
            ffmpeg.stdin.end();
        });

        // --- NOISE GATE & FADE IN/OUT (Elimina il metronomo / ticchettii) ---
        const totalSamples = pcmBuffer.length / 2;
        const threshold = 150; // Soglia di ampiezza minima per considerare rumore o silenzio

        // 1. Taglia il silenzio/rumore iniziale
        let startSample = 0;
        for (let i = 0; i < Math.min(totalSamples, 4000); i++) {
            if (Math.abs(pcmBuffer.readInt16LE(i * 2)) > threshold) {
                startSample = Math.max(0, i - 10); // Piccolo margine di sicurezza
                break;
            }
        }

        // 2. Taglia il silenzio/rumore finale
        let endSample = totalSamples;
        for (let i = totalSamples - 1; i > Math.max(0, totalSamples - 4000); i--) {
            if (Math.abs(pcmBuffer.readInt16LE(i * 2)) > threshold) {
                endSample = Math.min(totalSamples, i + 10);
                break;
            }
        }

        // Estrae il buffer pulito dai fruscii di testa e coda
        const slicedBuffer = pcmBuffer.subarray(startSample * 2, endSample * 2);

        // 3. Applicazione fade-in iniziale (20ms) per un attacco morbidissimo senza "tic"
        const fadeSamples = Math.min(320, slicedBuffer.length / 2);
        for (let i = 0; i < fadeSamples; i++) {
            const sample = slicedBuffer.readInt16LE(i * 2);
            const multiplier = i / fadeSamples;
            slicedBuffer.writeInt16LE(Math.floor(sample * multiplier), i * 2);
        }

        // 4. Aggiunta coda di silenzio finale (150ms) per rilasciare l'I2S senza loop
        const silenceSamples = 2400; 
        const silenceBuffer = Buffer.alloc(silenceSamples * 2, 0);
        const finalBuffer = Buffer.concat([slicedBuffer, silenceBuffer]);

        console.log(`[TTS PCM] Pulito e convertito: ${finalBuffer.length} byte per: "${text}"`);
        return finalBuffer;
    } catch (err) {
        console.error("[Errore Conversione PCM]", err.message);
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
    // Prompt ampliato: naturale ed elastico, permette risposte più articolate se richieste (es. barzellette, storie)
    const systemPrompt = `Sei Kairós, assistente IA vocale su ESP32-S3 per ${userName} a Valbrevenna. Contesto: "${deviceContext}". Rispondi in italiano in modo naturale, conciso ma esauriente (fornisci risposte complete se ti viene chiesto di raccontare barzellette, storie o spiegazioni).`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }],
            max_tokens: 150 // Aumentato il limite di token per evitare tagli a metà delle risposte
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
                                await new Promise(resolve => setTimeout(resolve, 10));
                            }
                            console.log("[WS] Flusso PCM pulito inviato.");
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
