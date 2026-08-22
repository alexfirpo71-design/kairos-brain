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

// Percorso per il file immagine temporaneo (sovrascrittura fissa)
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const FIXED_IMAGE_PATH = path.join(UPLOAD_DIR, 'ticket.jpg');

// =============================================
// --- HTTP SERVER SETUP ---
// =============================================
const server = createServer(async (req, res) => {
    // CORS Headers
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
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

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

            console.log(`[📸 OCR] Immagine ricevuta (${(imageBuffer.length / 1024).toFixed(2)} KB)`);

            // --- SOVRASCRITTURA FISSA SUL SERVER ---
            fs.writeFileSync(FIXED_IMAGE_PATH, imageBuffer);
            console.log(`[💾 File System] Immagine salvata (sovrascritta) in: ${FIXED_IMAGE_PATH}`);

            const apiKey = process.env.GROQ_API_KEY;
            if (!apiKey) {
                console.error('[❌ Config] GROQ_API_KEY non configurato!');
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Errore: API key non configurata.');
                return;
            }

            // --- VISION API CALL ---
            console.log('[🤖 Vision] Invio a Groq per elaborazione...');
            const visionResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'qwen/qwen3.6-27b',
                    messages: [
                        {
                            role: 'system',
                            content: 'Sei un estrattore di testo OCR. LEGGI E TRASCRIVI SOLO IL TESTO VISIBILE NELL\'IMMAGINE. Non descrivere, non analizzare, non commentare. SOLO TESTO PURO.'
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

            // Pulizia risposta
            resultText = resultText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            if (resultText.includes("4.")) {
                const parts = resultText.split(/4\.\s*\*\*.*?\*\*:/i);
                if (parts.length > 1) {
                    resultText = parts[1].trim().replace(/^["']|["']$/g, '');
                }
            }

            console.log(`[✓ OCR Result] "${resultText.substring(0, 100)}..."`);

            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Testo estratto: ${resultText}`);

            // --- INVIA RISPOSTA AL CLIENT ESP32 ---
            if (activeWsClient && activeWsClient.readyState === activeWsClient.OPEN) {
                console.log('[🔊 TTS] Preparazione risposta audio...');
                activeWsClient.isSpeaking = true;
                activeWsClient.send(JSON.stringify({ action: 'speak', text: resultText.trim() }));

                try {
                    const textChunks = splitTextIntoChunks(resultText, 180);
                    console.log(`[📝 Chunks] Diviso in ${textChunks.length} pezzi`);

                    for (let chunk of textChunks) {
                        if (!activeWsClient || activeWsClient.readyState !== activeWsClient.OPEN || !activeWsClient.isSpeaking) {
                            break;
                        }

                        const pcmPart = await getSingleTtsPcm(chunk, activeWsClient.volume || 70);

                        if (pcmPart && pcmPart.length > 0) {
                            const chunkSize = 4096;
                            for (let i = 0; i < pcmPart.length; i += chunkSize) {
                                if (!activeWsClient || activeWsClient.readyState !== activeWsClient.OPEN) break;

                                while (activeWsClient.bufferedAmount > 65536) {
                                    await new Promise(resolve => setTimeout(resolve, 20));
                                }

                                activeWsClient.send(
                                    pcmPart.subarray(i, i + Math.min(chunkSize, pcmPart.length - i)),
                                    { binary: true }
                                );
                            }
                        }
                        await new Promise(resolve => setTimeout(resolve, 400));
                    }

                    if (activeWsClient && activeWsClient.isSpeaking && activeWsClient.readyState === activeWsClient.OPEN) {
                        console.log('[✓ TTS] Streaming audio completato');
                        activeWsClient.send(JSON.stringify({ action: 'stop' }));
                    }
                    activeWsClient.isSpeaking = false;

                } catch (streamErr) {
                    console.error('[❌ TTS Error]', streamErr.message);
                    if (activeWsClient) activeWsClient.isSpeaking = false;
                }
            }

        } catch (err) {
            console.error('[❌ Upload Error]', err.message);
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Errore interno server.');
        }
    });

    req.on('error', (err) => {
        console.error('[❌ Request Error]', err.message);
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Errore nella richiesta.');
    });
}

// =============================================
// --- WEBSOCKET SERVER ---
// =============================================
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
    console.log(`\n[🔗 WS Connected] Da: ${req.socket.remoteAddress}`);
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

    // --- HEARTBEAT PING/PONG ---
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    const pingInterval = setInterval(() => {
        if (ws.isAlive === false) {
            clearInterval(pingInterval);
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        ws.ping();
    }, 30000);

    // --- MESSAGE HANDLER ---
    ws.on('message', async (message, isBinary) => {
        try {
            if (isBinary) {
                if (ws.isSpeaking || ws.isProcessing) return; // Ignora pacchetti audio se occupato
                audioBuffer.push(message);
                return;
            }

            const data = JSON.parse(message.toString());

            if (data.action === 'stop') {
                console.log('[⏹️ Stop] Comando ricevuto');
                ws.isSpeaking = false;
                ws.isProcessing = false;
                audioBuffer = [];
                return;
            }

            if (ws.isSpeaking) return;

            if (data.user) ws.userName = data.user;

            if (data.memories) {
                ws.memories = data.memories;
                console.log(`[🧠 Memorie Caricate] ${data.memories.substring(0, 50)}...`);
            }

            if (data.mac) {
                ws.mac = data.mac;
                if (!sessionHistories.has(data.mac)) {
                    sessionHistories.set(data.mac, []);
                }
                ws.conversationHistory = sessionHistories.get(data.mac);
                console.log(`[👤 Device] MAC: ${data.mac}, User: ${ws.userName}`);
            }

            if (data.device || data.location || data.status) {
                return;
            }

            if (data.state === 'processing') {
                // --- BLOCCO TOTALE ANTI-FLOOD (4 SECONDI DI COOLDOWN) ---
                const nowTime = Date.now();
                if (ws.isSpeaking || ws.isProcessing || (nowTime - lastRequestTime < 4000)) {
                    console.log('[⚠️ Anti-Flood] Richiesta audio scartata: Kairós è occupato o in cooldown.');
                    audioBuffer = [];
                    return;
                }

                ws.isProcessing = true;
                lastRequestTime = nowTime;

                const completeAudioBuffer = Buffer.concat(audioBuffer);
                audioBuffer = [];

                if (completeAudioBuffer.length === 0) {
                    console.log('[⚠️ Audio] Buffer vuoto');
                    ws.isProcessing = false;
                    return;
                }

                let replyText = null;

                try {
                    const transcript = await transcribeAudio(completeAudioBuffer);
                    console.log(`[🎙️ Whisper] "${transcript}"`);

                    if (transcript && transcript.trim().length > 0) {
                        const rawText = transcript.toLowerCase()
                            .replace(/[.,\/$%\^&\*;:{}=\-_`~()?]/g, "")
                            .trim();

                        const now = Date.now();
                        const isSessionActive = now < sessionActiveUntil;
                        const hasWakeWord = /kairos|cairos|cairo|ehi/.test(rawText);

                        if (!isSessionActive && !hasWakeWord) {
                            console.log('[🔇 VAD] Comando ignorato');
                            ws.isProcessing = false;
                            return;
                        }

                        sessionActiveUntil = now + SESSION_DURATION_MS;

                        if (/stop|fermati|basta|silenzio/.test(rawText)) {
                            ws.isSpeaking = false;
                            ws.isProcessing = false;
                            ws.send(JSON.stringify({ action: 'stop' }));
                            sessionActiveUntil = 0;
                            console.log('[✓ Stop] Eseguito');
                            return;
                        }

                        if (/alza|piu alto|volume su/.test(rawText)) {
                            ws.volume = Math.min(100, ws.volume + 15);
                            replyText = `Volume al ${ws.volume} per cento.`;
                            ws.conversationHistory.push({ role: 'user', content: transcript });
                            ws.conversationHistory.push({ role: 'assistant', content: replyText });
                        }
                        else if (/abbassa|piu basso|volume giu/.test(rawText)) {
                            ws.volume = Math.max(10, ws.volume - 15);
                            replyText = `Volume al ${ws.volume} per cento.`;
                            ws.conversationHistory.push({ role: 'user', content: transcript });
                            ws.conversationHistory.push({ role: 'assistant', content: replyText });
                        }
                        else if (/telecamera|guarda|inquadra|biglietto/.test(rawText)) {
                            console.log('[📸 Camera] Comando rilevato');
                            ws.send(JSON.stringify({ action: 'trigger_camera', text: 'Scatto...' }));
                            replyText = "Un attimo, guardo subito.";
                            ws.conversationHistory.push({ role: 'user', content: transcript });
                            ws.conversationHistory.push({ role: 'assistant', content: replyText });
                        }
                        else {
                            const isOnlyWakeWord = /^(kairos|ehi kairos|cairos|ehi kairos|ehi|cairo)$/.test(rawText)
                                || rawText.length < 5;

                            if (isOnlyWakeWord && !isSessionActive) {
                                replyText = "Dimmi pure.";
                                ws.conversationHistory.push({ role: 'user', content: transcript });
                                ws.conversationHistory.push({ role: 'assistant', content: replyText });
                            } else {
                                ws.conversationHistory.push({ role: 'user', content: transcript });
                                replyText = await getGroqChatResponse(ws.conversationHistory, ws.userName, ws.memories);
                                
                                if (replyText.startsWith("MEMORIZZA:")) {
                                    let cleanReplyForUser = replyText.replace("MEMORIZZA:", "").trim();
                                    console.log(`[💾 Memoria Rilevata] ${cleanReplyForUser}`);
                                    
                                    ws.send(JSON.stringify({ 
                                        action: 'save_memory', 
                                        data: cleanReplyForUser 
                                    }));
                                    
                                    replyText = "Fatto, memorizzato."; 
                                }
                                ws.conversationHistory.push({ role: 'assistant', content: replyText });

                                if (ws.conversationHistory.length > 10) {
                                    ws.conversationHistory = ws.conversationHistory.slice(-10);
                                }
                            }
                        }

                        console.log(`[💬 Risposta] "${replyText.substring(0, 60)}..." | Vol: ${ws.volume}%`);
                    } else {
                        ws.isProcessing = false;
                        return;
                    }
                } catch (err) {
                    console.error('[❌ AI Error]', err.message);
                    if (err.message.includes("429")) {
                        replyText = "Il sistema è momentaneamente sovraccarico, attendi un secondo.";
                    } else {
                        replyText = "Si è verificato un errore.";
                    }
                }

                if (!replyText || replyText.trim().length === 0) {
                    ws.isProcessing = false;
                    return;
                }

                ws.isSpeaking = true;
                ws.send(JSON.stringify({ action: 'speak', text: replyText.trim() }));
                sessionActiveUntil = Date.now() + 600000;

                try {
                    const textChunks = splitTextIntoChunks(replyText, 180);

                    for (let chunk of textChunks) {
                        if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;

                        sessionActiveUntil = Date.now() + 600000;
                        const pcmPart = await getSingleTtsPcm(chunk, ws.volume);

                        if (pcmPart && pcmPart.length > 0) {
                            const chunkSize = 4096;
                            for (let i = 0; i < pcmPart.length; i += chunkSize) {
                                if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;

                                while (ws.bufferedAmount > 65536) {
                                    await new Promise(resolve => setTimeout(resolve, 20));
                                }

                                ws.send(pcmPart.subarray(i, i + Math.min(chunkSize, pcmPart.length - i)), { binary: true });
                            }
                        }
                        await new Promise(resolve => setTimeout(resolve, 400));
                    }

                    if (ws.isSpeaking && ws.readyState === ws.OPEN) {
                        console.log('[✓ Chat] Streaming completato');
                        ws.send(JSON.stringify({ action: 'stop' }));
                    }
                    ws.isSpeaking = false;
                    ws.isProcessing = false; // Sblocca nuove richieste solo alla fine dello streaming
                    sessionActiveUntil = Date.now() + SESSION_DURATION_MS;

                } catch (streamErr) {
                    console.error('[❌ Streaming Error]', streamErr.message);
                    ws.isSpeaking = false;
                    ws.isProcessing = false; // Sblocca anche in caso di errore nello streaming
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
        audioBuffer = [];
        if (activeWsClient === ws) activeWsClient = null;
        console.log('[❌ WS Disconnected]\n');
    });

    ws.on('error', (err) => {
        console.error('[❌ WS Error]', err.message);
        ws.isProcessing = false;
        ws.isSpeaking = false;
    });
});

// =============================================
// --- UTILITY FUNCTIONS ---
// =============================================

function splitTextIntoChunks(text, maxLength = 180) {
    if (!text || text.length === 0) return [];
    if (text.length <= maxLength) return [text];

    const sentences = text.match(/[^.!?;:]+[.!?;:]+["']?|.+$/g) || [text];
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

function formatTimeForSpeech(text) {
    return text.replace(/\b([0-2]?[0-9])[:\.]([0-5][0-9])\b/g, (match, hours, minutes) => {
        const h = parseInt(hours, 10);
        const m = parseInt(minutes, 10);

        let hourText = h === 1 ? "l'una" : `le ${h}`;
        if (h === 0) hourText = "le ore zero";

        if (m === 0) return `${hourText} in punto`;
        if (m < 10) return `${hourText} e zero ${m}`;
        return `${hourText} e ${m}`;
    });
}

async function getSingleTtsPcm(textChunk, volumePercent = 70) {
    if (!textChunk || textChunk.trim().length === 0) return null;

    try {
        const timeFormatted = formatTimeForSpeech(textChunk);
        const speechFriendlyText = timeFormatted.replace(/Kairós|Kairos|Kairòs/gi, 'Cairos');
        const sanitizedText = speechFriendlyText
            .replace(/[*#_`~[\]()>]/g, '')
            .replace(/[^\w\sàèéìòùÀÈÉÌÒÙ.,?!]/g, '')
            .trim();

        if (sanitizedText.length === 0) return null;

        const cleanText = encodeURIComponent(sanitizedText);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${cleanText}&tl=it&client=tw-ob`;

        const response = await fetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 10000
        });

        if (!response.ok) {
            console.error(`[❌ TTS] Status ${response.status}`);
            return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        const mp3Buffer = Buffer.from(arrayBuffer);

        const volumeFactor = Math.max(0.1, Math.min(2, volumePercent / 70));

        return await new Promise((resolve, reject) => {
            const audioFilters = `compand=attacks=0:points=-70/-70|-45/-20|0/-10:gain=5,volume=${volumeFactor}`;

            const ffmpeg = spawn('ffmpeg', [
                '-i', 'pipe:0',
                '-af', audioFilters,
                '-f', 's16le',
                '-acodec', 'pcm_s16le',
                '-ac', '1',
                '-ar', '16000',
                'pipe:1'
            ], { stdio: ['pipe', 'pipe', 'ignore'] });

            let chunks = [];
            let errorOccurred = false;

            ffmpeg.stdout.on('data', chunk => chunks.push(chunk));

            ffmpeg.on('close', code => {
                if (errorOccurred) return;

                if (code === 0) {
                    let pcmBuffer = Buffer.concat(chunks);

                    const silenceSamples = 4000;
                    let paddedPcmBuffer = Buffer.concat([pcmBuffer, Buffer.alloc(silenceSamples * 2)]);

                    const fadeSamplesIn = Math.min(120, paddedPcmBuffer.length / 2);
                    for (let i = 0; i < fadeSamplesIn; i++) {
                        const sample = paddedPcmBuffer.readInt16LE(i * 2);
                        const multiplier = i / fadeSamplesIn;
                        paddedPcmBuffer.writeInt16LE(Math.floor(sample * multiplier), i * 2);
                    }

                    const fadeSamplesOut = silenceSamples;
                    const startOutIdx = (paddedPcmBuffer.length / 2) - fadeSamplesOut;
                    for (let i = 0; i < fadeSamplesOut; i++) {
                        const idx = (startOutIdx + i) * 2;
                        const sample = paddedPcmBuffer.readInt16LE(idx);
                        const multiplier = (fadeSamplesOut - i) / fadeSamplesOut;
                        paddedPcmBuffer.writeInt16LE(Math.floor(sample * multiplier), idx);
                    }

                    resolve(paddedPcmBuffer);
                } else {
                    reject(new Error(`FFmpeg code ${code}`));
                }
            });

            ffmpeg.on('error', err => {
                errorOccurred = true;
                reject(err);
            });

            ffmpeg.stdin.on('error', err => {
                errorOccurred = true;
                reject(err);
            });

            ffmpeg.stdin.write(mp3Buffer);
            ffmpeg.stdin.end();
        });
    } catch (err) {
        console.error('[❌ TTS Error]', err.message);
        return null;
    }
}

async function transcribeAudio(audioBuffer) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY mancante.");

    if (!audioBuffer || audioBuffer.length === 0) {
        throw new Error("Buffer audio vuoto.");
    }

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
        body: formData,
        timeout: 30000
    });

    if (!response.ok) {
        throw new Error(`Whisper: ${response.status}`);
    }
    const data = await response.json();
    return data.text || "";
}

async function getGroqChatResponse(conversationHistory, userName = "Alessandro", dynamicMemories = "") {
    const apiKey = process.env.GROQ_API_KEY;
    const systemPrompt = `Kairós, l'assistente IA avanzato di ${userName}. 
Parli sempre in italiano in modo diretto, deciso ma senza eccessive lungaggini e solo quando viene richiesto.

ISTRUZIONE CRITICA SULLA MEMORIA LOCALE:
Quando l'utente ti chiede esplicitamente di memorizzare, ricordare o salvare un fatto, un'informazione o una preferenza:
- DEVI iniziare la risposta ESATTAMENTE con le lettere MAIUSCOLE "MEMORIZZA: " seguite dal dato da ricordare.
- Subito dopo il comando, scrivi la frase di conferma che pronuncerai all'utente.
Esempio esatto di risposta: "MEMORIZZA: L'età di Tiziana è 55 anni. Fatto, ho memorizzato l'età di Tiziana."
Se non ti viene chiesto di memorizzare nulla, rispondi normalmente SENZA usare quel prefisso.

RICORDI SALVATI SUL DISPOSITIVO DELL'UTENTE (da usare attivamente se interrogato):
${dynamicMemories ? dynamicMemories : "Nessun ricordo aggiuntivo salvato al momento."}

CONTESTO PRIVATO (da usare ESCLUSIVAMENTE se l'utente ti fa domande dirette in merito):
- L'utente ha 55 anni e si chiama Alessandro, è un tecnico elettronico a Genova.
- Famiglia e affetti: la figlia Margot, la fidanzata Tiziana, papà Lino, mamma Elviana mancata il 23 dicembre 2024, il gatto Lulù, il coniglio Isalide, il cane Miele, e la gatta Prugna mancata a maggio 2026.
- Passioni tecniche: riparazione console vintage, simulazione di volo, pilota di droni.`;

    const messages = [{ role: 'system', content: systemPrompt }, ...conversationHistory];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'openai/gpt-oss-20b',
            messages: messages,
            max_tokens: 4000,
            temperature: 0.7
        }),
        timeout: 30000
    });

    if (!response.ok) {
        if (response.status === 429) throw new Error("Troppe richieste in corso. Attendi qualche secondo.");
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
    console.log(`\n╔════════════════════════════════════╗`);
    console.log(`║  🚀 Kairós Brain Server            ║`);
    console.log(`║  Port: ${PORT}                        ║`);
    console.log(`║  Status: ACTIVE                    ║`);
    console.log(`╚════════════════════════════════════╝\n`);
});
