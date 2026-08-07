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

function splitTextIntoChunks(text, maxLength = 200) {
    if (text.length <= maxLength) return [text];
    const sentences = text.match(/[^.!?]+[.!?]+["']?|.+$/g) || [text];
    let chunks = [];
    let currentChunk = "";

    for (let sentence of sentences) {
        if ((currentChunk + sentence).length <= maxLength) {
            currentChunk += sentence;
        } else {
            if (currentChunk) chunks.push(currentChunk.trim());
            if (sentence.length > maxLength) {
                let words = sentence.split(" ");
                let subChunk = "";
                for (let word of words) {
                    if ((subChunk + " " + word).length <= maxLength) {
                        subChunk += (subChunk ? " " : "") + word;
                    } else {
                        if (subChunk) chunks.push(subChunk.trim());
                        subChunk = word;
                    }
                }
                currentChunk = subChunk;
            } else {
                currentChunk = sentence;
            }
        }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
}

async function getSingleTtsPcm(textChunk) {
    try {
        const cleanText = encodeURIComponent(textChunk);
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
                '-af', 'atempo=1.15,equalizer=f=300:width_type=o:width=2:g=3,equalizer=f=3000:width_type=o:width=2:g=-2,acompressor=threshold=-18dB:ratio=3:attack=5:release=50',
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

        const silenceSamples = 4000; 
        let paddedPcmBuffer = Buffer.concat([pcmBuffer, Buffer.alloc(silenceSamples * 2)]);
        return paddedPcmBuffer;
    } catch (err) {
        console.error("[Errore TTS Singolo]:", err.message);
        return null;
    }
}

async function transcribeAudio(audioBuffer) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY mancante.");

    const dataLength = audioBuffer.length;
    const fileLength = dataLength + 36;
    const header = Buffer.from([
        0x52, 0x49, 0x46, 0x46,
        fileLength & 0xff, (fileLength >> 8) & 0xff, (fileLength >> 16) & 0xff, (fileLength >> 24) & 0xff,
        0x57, 0x41, 0x56, 0x45,
        0x66, 0x6d, 0x74, 0x20,
        16, 0, 0, 0,          
        1, 0,                 
        1, 0,                 
        16000 & 0xff, (16000 >> 8) & 0xff, (16000 >> 16) & 0xff, (16000 >> 24) & 0xff,
        32000 & 0xff, (32000 >> 8) & 0xff, (32000 >> 16) & 0xff, (32000 >> 24) & 0xff,
        2, 0,                 
        16, 0,                
        0x64, 0x61, 0x74, 0x61,
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

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Errore Whisper HTTP ${response.status}: ${errorBody}`);
    }
    const data = await response.json();
    return data.text;
}

async function getGroqChatResponse(conversationHistory, userName = "Alessandro") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY mancante.");

    const systemPrompt = `Sei Kairós, l'assistente IA di ${userName}. Rispondi sempre in italiano in modo diretto e tecnico.`;
    const messages = [{ role: 'system', content: systemPrompt }, ...conversationHistory];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: messages,
            max_tokens: 300,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Errore Chat HTTP ${response.status}: ${errorBody}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}

wss.on('connection', (ws, req) => {
    console.log(`[WS] Connesso da: ${req.socket.remoteAddress}`);
    ws.userName = "Alessandro";
    ws.conversationHistory = [];
    let audioChunks = [];
    let isProcessing = false;

    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            audioChunks.push(Buffer.isBuffer(message) ? message : Buffer.from(message));
        } else {
            try {
                const textMsg = message.toString();
                if (textMsg.startsWith('{')) {
                    const data = JSON.parse(textMsg);
                    
                    if (data.state === 'listening') {
                        audioChunks = [];
                        isProcessing = false;
                    }

                    if (data.state === 'processing' && !isProcessing) {
                        isProcessing = true;
                        const completeAudioBuffer = Buffer.concat(audioChunks);
                        audioChunks = []; // Svuota subito per evitare doppie elaborazioni

                        let replyText = "Ricevuto.";
                        try {
                            console.log(`[Whisper] Elaborazione audio: ${completeAudioBuffer.length} bytes`);
                            if (completeAudioBuffer.length > 500) {
                                const transcript = await transcribeAudio(completeAudioBuffer);
                                console.log(`[Whisper] Trascritto: "${transcript}"`);
                                
                                if (transcript && transcript.trim().length > 0) {
                                    ws.conversationHistory.push({ role: 'user', content: transcript });
                                    replyText = await getGroqChatResponse(ws.conversationHistory, ws.userName);
                                    ws.conversationHistory.push({ role: 'assistant', content: replyText });
                                } else {
                                    replyText = "Non ho udito chiaramente, potresti ripetere?";
                                }
                            } else {
                                replyText = "Registrazione troppo corta.";
                            }
                        } catch (err) {
                            console.error("[ERRORE PIPELINE SERVER]:", err);
                            replyText = "Si è verificato un errore di elaborazione interno.";
                        }

                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({ action: 'speak', text: replyText }));
                        }

                        try {
                            const textChunks = splitTextIntoChunks(replyText, 200);
                            for (let chunk of textChunks) {
                                if (ws.readyState !== ws.OPEN) break;
                                const pcmPart = await getSingleTtsPcm(chunk);
                                if (pcmPart && pcmPart.length > 0) {
                                    for (let i = 0; i < pcmPart.length; i += 1024) {
                                        if (ws.readyState !== ws.OPEN) break;
                                        ws.send(pcmPart.subarray(i, i + 1024));
                                    }
                                }
                            }
                            if (ws.readyState === ws.OPEN) {
                                ws.send(JSON.stringify({ action: 'stop' }));
                            }
                        } catch (streamErr) {
                            console.error("[Errore Streaming Audio]:", streamErr);
                        } finally {
                            isProcessing = false;
                        }
                    }
                }
            } catch (e) {
                console.log('[WS Messaggio non JSON]:', message.toString());
            }
        }
    });

    ws.on('close', () => {
        console.log("[WS] Connessione chiusa.");
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Kairos Brain Server in ascolto sulla porta ${PORT}`));
