import http, { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Definizione __dirname per ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================
// --- GLOBAL STATE ---
// =============================================
let activeWsClient = null;
const sessionHistories = new Map();

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const FIXED_IMAGE_PATH = path.join(UPLOAD_DIR, 'ticket.jpg');

// =============================================
// --- HTTP SERVER SETUP ---
// =============================================
const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/upload') {
        handleImageUpload(req, res);
    } else if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('🚀 Kairos Brain Server is running!\n');
    }
});

// =============================================
// --- IMAGE UPLOAD HANDLER ---
// =============================================
async function handleImageUpload(req, res) {
    let buffers = [];
    let totalSize = 0;
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

    req.on('data', chunk => {
        totalSize += chunk.length;
        if (totalSize > MAX_IMAGE_SIZE) {
            req.pause();
            res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Immagine troppo grande (max 5MB).');
            return;
        }
        buffers.push(chunk);
    });

    req.on('end', async () => {
        try {
            const imageBuffer = Buffer.concat(buffers);
            if (!imageBuffer || imageBuffer.length === 0) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Errore: Immagine vuota.');
                return;
            }

            fs.writeFileSync(FIXED_IMAGE_PATH, imageBuffer);
            const apiKey = process.env.GROQ_API_KEY;
            if (!apiKey) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Errore: API key non configurata.');
                return;
            }

            // --- VISION API CALL AGGIORNATA ---
            const visionResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'openai/gpt-oss-20b', // Sostituito con modello standard supportato
                    messages: [
                        {
                            role: 'system',
                            content: 'Sei un estrattore di testo OCR. LEGGI E TRASCRIVI SOLO IL TESTO VISIBILE NELL\'IMMAGINE. SOLO TESTO PURO.'
                        },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: 'Trascrivi tutto il testo visibile in questa immagine.' },
                                { 
                                    type: 'image_url', 
                                    image_url: { 
                                        url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` 
                                    } 
                                }
                            ]
                        }
                    ],
                    max_tokens: 300,
                    temperature: 0.0
                }),
                timeout: 30000
            });

            if (!visionResponse.ok) {
                const errorBody = await visionResponse.text();
                console.error(`[❌ Vision Error] ${visionResponse.status}: ${errorBody}`);
                res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Errore elaborazione immagine.');
                return;
            }

            const visionData = await visionResponse.json();
            let resultText = visionData.choices[0].message.content.trim();

            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Testo estratto: ${resultText}`);

            if (activeWsClient && activeWsClient.readyState === activeWsClient.OPEN) {
                activeWsClient.isSpeaking = true;
                activeWsClient.send(JSON.stringify({ action: 'speak', text: resultText.trim() }));

                const textChunks = splitTextIntoChunks(resultText, 180);
                for (let chunk of textChunks) {
                    if (!activeWsClient || !activeWsClient.isSpeaking) break;
                    const pcmPart = await getSingleTtsPcm(chunk, activeWsClient.volume || 70);
                    if (pcmPart) {
                        for (let i = 0; i < pcmPart.length; i += 4096) {
                            if (activeWsClient.readyState !== activeWsClient.OPEN) break;
                            while (activeWsClient.bufferedAmount > 65536) {
                                await new Promise(r => setTimeout(r, 10));
                            }
                            activeWsClient.send(pcmPart.subarray(i, i + 4096), { binary: true });
                        }
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
                activeWsClient.send(JSON.stringify({ action: 'stop' }));
                activeWsClient.isSpeaking = false;
            }
        } catch (err) {
            console.error('[❌ Upload Error]', err.message);
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Errore interno server.');
        }
    });
});

// =============================================
// --- WEBSOCKET SERVER ---
// =============================================
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
    activeWsClient = ws;
    ws.userName = "Alessandro";
    ws.conversationHistory = [];
    ws.isSpeaking = false;
    ws.isProcessing = false; 
    ws.volume = 70;
    ws.isAlive = true;
    ws.memories = "";

    let audioBuffer = [];
    let sessionActiveUntil = 0;
    let lastRequestTime = 0; 
    const SESSION_DURATION_MS = 20000;

    ws.on('pong', () => { ws.isAlive = true; });

    const pingInterval = setInterval(() => {
        if (!ws.isAlive) {
            clearInterval(pingInterval);
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        ws.ping();
    }, 30000);

    ws.on('message', async (message, isBinary) => {
        try {
            if (isBinary) {
                if (ws.isSpeaking || ws.isProcessing) return;
                audioBuffer.push(message);
                return;
            }

            const data = JSON.parse(message.toString());

            if (data.action === 'stop') {
                ws.isSpeaking = false;
                ws.isProcessing = false;
                audioBuffer = [];
                return;
            }

            if (ws.isSpeaking) return;
            if (data.user) ws.userName = data.user;
            if (data.memories) ws.memories = data.memories;
            if (data.mac) {
                ws.mac = data.mac;
                if (!sessionHistories.has(data.mac)) sessionHistories.set(data.mac, []);
                ws.conversationHistory = sessionHistories.get(data.mac);
            }

            if (data.state === 'processing') {
                const nowTime = Date.now();
                if (ws.isSpeaking || ws.isProcessing || (nowTime - lastRequestTime < 600)) {
                    audioBuffer = [];
                    return;
                }

                ws.isProcessing = true;
                lastRequestTime = nowTime;

                const completeAudioBuffer = Buffer.concat(audioBuffer);
                audioBuffer = [];

                if (completeAudioBuffer.length === 0) {
                    ws.isProcessing = false;
                    return;
                }

                let replyText = null;

                try {
                    const transcript = await transcribeAudio(completeAudioBuffer);
                    console.log(`[🎙️ Whisper] "${transcript}"`);

                    if (transcript && transcript.trim().length > 0) {
                        const rawText = transcript.toLowerCase().replace(/[.,\/$%\^&\*;:{}=\-_`~()?]/g, "").trim();

                        if (rawText.length < 3 || /^(grazie|ok|ah|eh|oh)$/.test(rawText)) {
                            ws.isProcessing = false;
                            return;
                        }

                        sessionActiveUntil = Date.now() + SESSION_DURATION_MS;

                        if (/stop|fermati|basta|silenzio/.test(rawText)) {
                            ws.isSpeaking = false;
                            ws.isProcessing = false;
                            ws.send(JSON.stringify({ action: 'stop' }));
                            return;
                        }

                        if (/alza|piu alto|volume su/.test(rawText)) {
                            ws.volume = Math.min(100, ws.volume + 15);
                            replyText = `Volume al ${ws.volume} per cento.`;
                        } else if (/abbassa|piu basso|volume giu/.test(rawText)) {
                            ws.volume = Math.max(10, ws.volume - 15);
                            replyText = `Volume al ${ws.volume} per cento.`;
                        } else {
                            ws.conversationHistory.push({ role: 'user', content: transcript });
                            replyText = await getGroqChatResponse(ws.conversationHistory, ws.userName, ws.memories);
                            
                            if (replyText.startsWith("MEMORIZZA:")) {
                                let cleanReplyForUser = replyText.replace("MEMORIZZA:", "").trim();
                                ws.send(JSON.stringify({ action: 'save_memory', data: cleanReplyForUser }));
                                replyText = "Fatto, memorizzato."; 
                            }
                            ws.conversationHistory.push({ role: 'assistant', content: replyText });
                            if (ws.conversationHistory.length > 10) ws.conversationHistory = ws.conversationHistory.slice(-10);
                        }
                    } else {
                        ws.isProcessing = false;
                        return;
                    }
                } catch (err) {
                    console.error('[❌ AI Error Completo]:', err);
                    replyText = `Errore di connessione con l'intelligenza artificiale.`;
                }

                if (!replyText) {
                    ws.isProcessing = false;
                    return;
                }

                ws.isSpeaking = true;
                ws.send(JSON.stringify({ action: 'speak', text: replyText.trim() }));

                try {
                    const textChunks = splitTextIntoChunks(replyText, 180);
                    for (let chunk of textChunks) {
                        if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
                        const pcmPart = await getSingleTtsPcm(chunk, ws.volume);
                        if (pcmPart) {
                            for (let i = 0; i < pcmPart.length; i += 4096) {
                                if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
                                while (ws.bufferedAmount > 65536) {
                                    await new Promise(r => setTimeout(r, 10));
                                }
                                ws.send(pcmPart.subarray(i, i + 4096), { binary: true });
                            }
                        }
                        await new Promise(r => setTimeout(r, 200));
                    }

                    if (ws.isSpeaking && ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({ action: 'stop' }));
                    }
                    ws.isSpeaking = false;
                    ws.isProcessing = false; 
                } catch (streamErr) {
                    ws.isSpeaking = false;
                    ws.isProcessing = false; 
                }
            }
        } catch (e) {
            ws.isProcessing = false;
            ws.isSpeaking = false;
        }
    });

    ws.on('close', () => {
        clearInterval(pingInterval);
        ws.isSpeaking = false;
        ws.isProcessing = false;
        if (activeWsClient === ws) activeWsClient = null;
    });
});

// =============================================
// --- UTILITY FUNCTIONS ---
// =============================================

function splitTextIntoChunks(text, maxLength = 180) {
    if (!text) return [];
    if (text.length <= maxLength) return [text];
    const sentences = text.match(/[^.!?;:]+[.!?;:]+["']?|.+$/g) || [text];
    let chunks = [], currentChunk = "";
    for (let sentence of sentences) {
        if ((currentChunk + sentence).length <= maxLength) {
            currentChunk += sentence;
        } else {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = sentence;
        }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
}

function formatTimeForSpeech(text) {
    return text.replace(/\b([0-2]?[0-9])[:\.]([0-5][0-9])\b/g, (match, h, m) => {
        let hourText = h === '1' ? "l'una" : `le ${h}`;
        if (m === '00') return `${hourText} in punto`;
        return `${hourText} e ${m}`;
    });
}

async function getSingleTtsPcm(textChunk, volumePercent = 70) {
    if (!textChunk) return null;
    try {
        const sanitizedText = formatTimeForSpeech(textChunk).replace(/[*#_`~[\]()>]/g, '').trim();
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(sanitizedText)}&tl=it&client=tw-ob`;

        const response = await fetch(ttsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
        if (!response.ok) return null;

        const mp3Buffer = Buffer.from(await response.arrayBuffer());
        const volumeFactor = Math.max(0.1, Math.min(2, volumePercent / 70));

        return await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', 'pipe:0',
                '-af', `volume=${volumeFactor},atempo=1.03`,
                '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000',
                'pipe:1'
            ], { stdio: ['pipe', 'pipe', 'ignore'] });

            let chunks = [];
            ffmpeg.stdout.on('data', c => chunks.push(c));
            ffmpeg.on('close', code => {
                if (code === 0) {
                    let pcmBuffer = Buffer.concat(chunks);
                    resolve(Buffer.concat([pcmBuffer, Buffer.alloc(4000)]));
                } else {
                    reject(new Error(`FFmpeg code ${code}`));
                }
            });
            ffmpeg.stdin.write(mp3Buffer);
            ffmpeg.stdin.end();
        });
    } catch (err) {
        return null;
    }
}

async function transcribeAudio(audioBuffer) {
    const apiKey = process.env.GROQ_API_KEY;
    const dataLength = audioBuffer.length;
    const fileLength = dataLength + 36;
    const header = Buffer.from([
        0x52, 0x49, 0x46, 0x46,
        fileLength & 0xff, (fileLength >> 8) & 0xff, (fileLength >> 16) & 0xff, (fileLength >> 24) & 0xff,
        0x57, 0x41, 0x56, 0x45,
        0x66, 0x6d, 0x74, 0x20,
        16, 0, 0, 0, 1, 0, 1, 0,
        16000 & 0xff, (16000 >> 8) & 0xff, 0, 0,
        32000 & 0xff, (32000 >> 8) & 0xff, 0, 0,
        2, 0, 16, 0,
        0x64, 0x61, 0x74, 0x61,
        dataLength & 0xff, (dataLength >> 8) & 0xff, (dataLength >> 16) & 0xff, (dataLength >> 24) & 0xff
    ]);

    const formData = new FormData();
    formData.append('file', Buffer.concat([header, audioBuffer]), { filename: 'audio.wav', contentType: 'audio/wav' });
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'it');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, ...formData.getHeaders() },
        body: formData,
        timeout: 30000
    });

    if (!response.ok) throw new Error(`Whisper: ${response.status}`);
    const data = await response.json();
    return data.text || "";
}

async function getGroqChatResponse(conversationHistory, userName = "Alessandro", dynamicMemories = "") {
    const apiKey = process.env.GROQ_API_KEY;
    const systemPrompt = `Kairós, l'assistente IA di ${userName}. Parla in italiano in modo sintetico, diretto e conciso (massimo 2-3 frasi).`;
    const messages = [{ role: 'system', content: systemPrompt }, ...conversationHistory];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'openai/gpt-oss-20b', // Modello standard stabile su Groq
            messages: messages,
            max_tokens: 1024,
            temperature: 0.7
        }),
        timeout: 30000
    });

    if (!response.ok) {
        const errBody = await response.text();
        console.error(`[❌ Groq API Error]`, errBody);
        throw new Error(`Errore Chat: ${response.status}`);
    }
    const data = await response.json();
    return data.choices[0].message.content || "Errore risposta.";
}

// =============================================
// --- SERVER STARTUP ---
// =============================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 Kairós Brain Server attivo sulla porta ${PORT}\n`);
});
