import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';

const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Kairos Brain Server is running!\n');
});

const wss = new WebSocketServer({ server, path: '/ws' });

function addWavHeader(audioBuffer, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
    const dataLength = audioBuffer.length;
    const fileLength = dataLength + 36;

    const header = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // "RIFF"
        fileLength & 0xff, (fileLength >> 8) & 0xff, (fileLength >> 16) & 0xff, (fileLength >> 24) & 0xff,
        0x57, 0x41, 0x56, 0x45, // "WAVE"
        0x66, 0x6d, 0x74, 0x20, // "fmt "
        16, 0, 0, 0,            // SubChunk1Size (16 for PCM)
        1, 0,                   // AudioFormat (1 for PCM)
        channels, 0,            // NumChannels
        sampleRate & 0xff, (sampleRate >> 8) & 0xff, (sampleRate >> 16) & 0xff, (sampleRate >> 24) & 0xff,
        (sampleRate * channels * (bitsPerSample / 8)) & 0xff,
        ((sampleRate * channels * (bitsPerSample / 8)) >> 8) & 0xff,
        ((sampleRate * channels * (bitsPerSample / 8)) >> 16) & 0xff,
        ((sampleRate * channels * (bitsPerSample / 8)) >> 24) & 0xff,
        0, 0,                   // BlockAlign placeholder
        bitsPerSample, 0,       // BitsPerSample
        0x64, 0x61, 0x74, 0x61, // "data"
        dataLength & 0xff, (dataLength >> 8) & 0xff, (dataLength >> 16) & 0xff, (dataLength >> 24) & 0xff
    ]);

    header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
    return Buffer.concat([header, audioBuffer]);
}

// Generatore di segnale PCM pulito a 16kHz (compatibile al 100% con l'ESP32)
function generatePcmBeep(durationMs = 1000, sampleRate = 16000, frequency = 600) {
    const numSamples = (sampleRate * durationMs) / 1000;
    const buffer = Buffer.alloc(numSamples * 2);

    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        // Effetto modulato per renderlo meno piatto del beep continuo
        const envelope = Math.sin((i / numSamples) * Math.PI); 
        const sample = Math.sin(2 * Math.PI * frequency * t) * 8000 * envelope;
        buffer.writeInt16LE(Math.round(sample), i * 2);
    }
    return buffer;
}

async function transcribeAudio(audioBuffer) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY mancante.");

    const wavBuffer = addWavHeader(audioBuffer);
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
    const systemPrompt = `Sei Kairós, assistente IA vocale su ESP32-S3 per ${userName} a Valbrevenna. Contesto: "${deviceContext}". Rispondi in modo sintetico e tecnico in italiano.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }],
            max_tokens: 150
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

                    // Invia il testo al client
                    ws.send(JSON.stringify({ action: 'speak', state: 'idle', text: replyText }));

                    // Invia l'audio PCM pulito all'ESP32 subito dopo
                    setTimeout(() => {
                        const pcmAudio = generatePcmBeep(1200, 16000, 660);
                        ws.send(pcmAudio);
                        console.log("[WS] Audio PCM inviato.");
                    }, 100);

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
