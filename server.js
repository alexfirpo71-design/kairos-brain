import http, { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// AGGIUNTA: File JSON per la persistenza dei dati memorizzati (comandi MEMORIZZA:)
const MEMORY_FILE = path.join(__dirname, 'kairos_memory.json');

function loadPersistedMemory() {
    try {
        if (fs.existsSync(MEMORY_FILE)) {
            const data = fs.readFileSync(MEMORY_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error("Errore nel caricamento della memoria persistente:", err);
    }
    return [];
}

function savePersistedMemory(memoryList) {
    try {
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryList, null, 2), 'utf8');
    } catch (err) {
        console.error("Errore nel salvataggio della memoria persistente:", err);
    }
}

// Inizializzazione della memoria persistente
let persistentMemory = loadPersistedMemory();

// AGGIUNTA: Mappa per gestire i client connessi basata sul MAC address
const activeClients = new Map();
let activeWsClient = null;

const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/upload') {
        const clientMac = req.headers['x-device-mac'];
        let buffers = [];
        req.on('data', chunk => buffers.push(chunk));
        req.on('end', async () => {
            const imageBuffer = Buffer.concat(buffers);
            try {
                if (!imageBuffer || imageBuffer.length === 0) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Immagine vuota o non ricevuta.');
                    return;
                }

                console.log("[Server] Immagine ricevuta dall'ESP32 tramite POST, elaborazione in corso...");
                const apiKey = process.env.GROQ_API_KEY;
                
                const visionResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'qwen/qwen3.6-27b',
                        messages: [
                            {
                                role: 'system',
                                content: 'Sei un estrattore di testo. Il tuo compito è LEGGERE E TRASCRIVERE SOLO IL TESTO PRESENTE NELL IMMAGINE. Non descrivere cosa vedi, non analizzare codice, non scrivere commenti. RESTITUISCI SOLO ED ESCLUSIVAMENTE IL TESTO SCRITTO CHE VEDI, SENZA AGGIUNGERE NESSUNA PAROLA DI CONTORNO.'
                            },
                            {
                                role: 'user',
                                content: [
                                    { type: 'text', text: 'Trascrivi solo il testo visibile in questa immagine.' },
                                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` } }
                                ]
                            }
                        ],
                        max_tokens: 200,
                        temperature: 0.0 
                    })
                });

                if (!visionResponse.ok) {
                    const errorBody = await visionResponse.text();
                    console.error(`[Errore Dettagliato Groq] Status: ${visionResponse.status} - Body: ${errorBody}`);
                    throw new Error(`Errore API: ${visionResponse.status}`);
                }
                
                const visionData = await visionResponse.json();
                let rawText = visionData.choices[0].message.content.trim();
                
                let resultText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

                if (resultText.includes("4.")) {
                    const parts = resultText.split(/4\.\s*\*\*.*?\*\*:/i);
                    if (parts.length > 1) {
                        resultText = parts[1].trim().replace(/^["']|["']$/g, '');
                    }
                }
                if (resultText.includes("Draft the response")) {
                    const match = resultText.match(/["']([^"']+)["']/g);
                    if (match && match.length > 0) {
                        resultText = match[match.length - 1].replace(/["']/g, '');
                    }
                }
                
                console.log(`[Risposta Monitor] "${resultText}"`);
                
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`Immagine ricevuta ed elaborata con successo: ${resultText}`);

                // Seleziona il client target basandosi sul MAC (header o mappa) o sul fallback
                let targetWs = null;
                if (clientMac && activeClients.has(clientMac)) {
                    targetWs = activeClients.get(clientMac);
                } else if (activeWsClient && activeWsClient.readyState === activeWsClient.OPEN) {
                    targetWs = activeWsClient;
                } else if (activeClients.size > 0) {
                    targetWs = activeClients.values().next().value;
                }

                if (targetWs && targetWs.readyState === targetWs.OPEN) {
                    console.log("[WS] Invio audio della descrizione dello scatto all'ESP32...");
                    targetWs.isSpeaking = true;
                    targetWs.send(JSON.stringify({ action: 'speak', text: resultText.trim() }));

                    try {
                        const textChunks = splitTextIntoChunks(resultText, 150);
                        
                        for (let chunk of textChunks) {
                            if (targetWs.readyState !== targetWs.OPEN || !targetWs.isSpeaking) break;
                            const pcmPart = await getSingleTtsPcm(chunk, currentVolume);
                            
                            if (pcmPart && pcmPart.length > 0) {
                                const chunkSize = 4096;
                                for (let i = 0; i < pcmPart.length; i += chunkSize) {
                                    if (targetWs.readyState !== targetWs.OPEN || !targetWs.isSpeaking) break;
                                    
                                    while (targetWs.bufferedAmount > 65536) {
                                        await new Promise(resolve => setTimeout(resolve, 20));
                                        if (targetWs.readyState !== targetWs.OPEN || !targetWs.isSpeaking) break;
                                    }
                                    
                                    targetWs.send(pcmPart.subarray(i, i + Math.min(chunkSize, pcmPart.length - i)), { binary: true });
                                }
                            }
                            await new Promise(resolve => setTimeout(resolve, 300));
                        }

                        if (targetWs.isSpeaking) {
                            console.log("[WS] Streaming audio dello scatto completato.");
                            if (targetWs.readyState === targetWs.OPEN) {
                                targetWs.send(JSON.stringify({ action: 'stop' }));
                            }
                        }
                        targetWs.isSpeaking = false;
                    } catch (streamErr) {
                        console.error("[Errore Streaming Audio Scatto]", streamErr);
                        if (targetWs) targetWs.isSpeaking = false;
                    }
                }

            } catch (err) {
                console.error("[Errore Upload]", err.message);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Errore interno del server durante l elaborazione dell immagine.');
            }
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Kairos Brain Server is running!\n');
    }
});

const wss = new WebSocketServer({ server, path: '/ws' });

const sessionHistories = new Map();
let currentVolume = 70;

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

function splitTextIntoChunks(text, maxLength = 250) {
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

async function getSingleTtsPcm(textChunk, volumePercent) {
    try {
        const timeFormatted = formatTimeForSpeech(textChunk);

        const speechFriendlyText = timeFormatted
            .replace(/Kairós|Kairos|Kairòs/gi, 'Cairos');

        const sanitizedText = speechFriendlyText
            .replace(/[*#_`~[\]()>]/g, '')
            .replace(/[^\w\sàèéìòùÀÈÉÌÒÙ.,?!]/g, '')
            .trim();

        const cleanText = encodeURIComponent(sanitizedText);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${cleanText}&tl=it&client=tw-ob`;
        
        const response = await fetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        if (!response.ok) {
            console.error(`[Errore TTS] Status ${response.status} per: "${sanitizedText}"`);
            throw new Error(`Errore TTS HTTP: ${response.status}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const mp3Buffer = Buffer.from(arrayBuffer);

        const volumeFactor = Math.max(0.05, volumePercent / 70);

        const pcmBuffer = await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', 'pipe:0',
                '-af', `volume=${volumeFactor},equalizer=f=300:width_type=o:width=2:g=2,acompressor=threshold=-20dB:ratio=2:attack=5:release=50`,
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

        return paddedPcmBuffer;
    } catch (err) {
        console.error("[Errore TTS Singolo]", err.message);
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

    if (!response.ok) throw new Error(`Errore Whisper: ${response.status}`);
    const data = await response.json();
    return data.text;
}

async function getGroqChatResponse(conversationHistory, userName = "Alessandro") {
    const apiKey = process.env.GROQ_API_KEY;
    
    // Includiamo anche la memoria persistente caricata all'avvio nel system prompt per dare continuità
    const memoryContextText = persistentMemory.length > 0 
        ? "\nMEMORIA PERSISTENTE ATTUALE:\n" + persistentMemory.map(m => `- ${m.content}`).join('\n') 
        : "";

    const systemPrompt = `Kairós, l'assistente IA avanzato di ${userName}. 
Parli sempre in italiano in modo diretto, deciso ma senza eccessive lungaggini e solo quando viene richiesto.

ISTRUZIONE CRITICA SULLA MEMORIA LOCALE:
Quando l'utente ti chiede esplicitamente di memorizzare, ricordare o salvare un fatto, un'informazione o una preferenza (es. "memorizza che...", "ricordati che..."):
- NON rifiutarti mai e non dire che non puoi farlo.
- DEVI iniziare la tua risposta tassativamente con la stringa esatta "MEMORIZZA: " seguita dall'informazione da ricordare in modo sintetico.
Esempio corretto: "MEMORIZZA: L'età di Tiziana è 50 anni."
Se non ti viene chiesto di memorizzare nulla, rispondi normalmente senza usare quel prefisso.
${memoryContextText}

CONTESTO PRIVATO (da usare ESCLUSIVAMENTE se l'utente ti fa domande dirette in merito, non menzionarlo mai di tua spontanea volontà):
- L'utente ha 55 anni e si chiama Alessandro, è un perito elettronico a Genova.
- Famiglia e affetti: la figlia Margot, la fidanzata Tiziana, papà Lino, mamma Elviana mancata il 24 dicembre 2024, i gatti Lulù, il coniglio Isalide, il cane Miele, e la gatta Prugna mancata l'11 maggio 2026.
- Passioni tecniche: retrogaming, flight simulation, pilota di drone.`;

    const messages = [{ role: 'system', content: systemPrompt }, ...conversationHistory];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'openai/gpt-oss-20b',
            messages: messages,
            max_tokens: 4000,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        if (response.status === 429) {
            throw new Error("Troppe richieste in corso. Attendi qualche secondo.");
        }
        throw new Error(`Errore Chat: ${response.status}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}

wss.on('connection', (ws, req) => {
    console.log(`[WS] Connesso da: ${req.socket.remoteAddress}`);
    activeWsClient = ws;
    ws.userName = "Alessandro";
    ws.conversationHistory = [];
    ws.deviceMac = null;
    ws.isSpeaking = false;
    let audioBuffer = [];

    let sessionActiveUntil = 0;
    const SESSION_DURATION_MS = 20000;

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const pingInterval = setInterval(() => {
        if (ws.isAlive === false) {
            clearInterval(pingInterval);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    }, 30000);

    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            if (ws.isSpeaking) return;
            audioBuffer.push(message);
        } else {
            try {
                // Gestione messaggi strutturati JSON o handshake iniziale
                let data;
                try {
                    data = JSON.parse(message.toString());
                } catch (e) {
                    data = null;
                }

                // Gestione handshake MAC address
                if (data && data.type === 'handshake' && data.mac) {
                    ws.deviceMac = data.mac;
                    activeClients.set(ws.deviceMac, ws);
                    console.log(`Dispositivo registrato tramite MAC: ${ws.deviceMac}`);
                    ws.send(JSON.stringify({ status: 'connected', mac: ws.deviceMac }));
                    return;
                }

                if (data && data.mac) {
                    ws.deviceMac = data.mac;
                    activeClients.set(ws.deviceMac, ws);
                    if (!sessionHistories.has(data.mac)) {
                        sessionHistories.set(data.mac, []);
                    }
                    ws.conversationHistory = sessionHistories.get(data.mac);
                }

                if (data && data.action === 'stop') {
                    console.log("[WS] Comando di stop ricevuto dall'ESP32.");
                    ws.isSpeaking = false;
                    audioBuffer = [];
                    return;
                }

                if (ws.isSpeaking) {
                    return;
                }

                if (data && data.user) ws.userName = data.user;

                if (data && (data.mac || data.device || data.user || data.location || data.status) && !data.state) {
                    return;
                }

                if (data && data.state === 'processing') {
                    const completeAudioBuffer = Buffer.concat(audioBuffer);
                    audioBuffer = [];

                    let replyText = null; 
                    try {
                        const transcript = await transcribeAudio(completeAudioBuffer);
                        console.log(`[Whisper] Trascritto: "${transcript}"`);
                        
                        if (transcript && transcript.trim().length > 0) {
                            const rawText = transcript.toLowerCase().replace(/[.,\/$%\^&\*;:{}=\-_`~()?]/g, "").trim();
                            const now = Date.now();

                            const isSessionActive = now < sessionActiveUntil;

                            const hasWakeWord = rawText.includes('kairos') || rawText.includes('cairos') || rawText.includes('cairo') || rawText.includes('ehi');

                            if (!isSessionActive && !hasWakeWord) {
                                console.log(`[Ignorato] Rumore di fondo o parlato estraneo: "${transcript}"`);
                                return; 
                            }

                            sessionActiveUntil = now + SESSION_DURATION_MS;

                            if (rawText.includes('stop') || rawText.includes('fermati') || rawText.includes('basta') || rawText.includes('silenzio')) {
                                ws.isSpeaking = false;
                                ws.send(JSON.stringify({ action: 'stop' }));
                                console.log("[Comando] Interruzione eseguita.");
                                sessionActiveUntil = 0; 
                                return;
                            }

                            if (rawText.includes('alza') || rawText.includes('piu alto') || rawText.includes('volume su')) {
                                currentVolume = Math.min(100, currentVolume + 15);
                                replyText = `Volume al ${currentVolume} per cento.`;
                                ws.conversationHistory.push({ role: 'user', content: transcript });
                                ws.conversationHistory.push({ role: 'assistant', content: replyText });
                            } 
                            else if (rawText.includes('abbassa') || rawText.includes('piu basso') || rawText.includes('volume giu')) {
                                currentVolume = Math.max(10, currentVolume - 15);
                                replyText = `Volume al ${currentVolume} per cento.`;
                                ws.conversationHistory.push({ role: 'user', content: transcript });
                                ws.conversationHistory.push({ role: 'assistant', content: replyText });
                            } 
                            else if (rawText.includes('telecamera') || rawText.includes('guarda') || rawText.includes('inquadra') || rawText.includes('biglietto')) {
                                console.log("[WS] Intenzione telecamera rilevata. Invio comando di scatto all'ESP32...");
                                
                                ws.send(JSON.stringify({ action: 'trigger_camera', text: 'Scatto la foto...' }));

                                replyText = "Un attimo, guardo subito.";
                                ws.conversationHistory.push({ role: 'user', content: transcript });
                                ws.conversationHistory.push({ role: 'assistant', content: replyText });
                            }
                            else {
                                const isOnlyWakeWord = rawText === 'kairos' || rawText === 'ehi kairos' || rawText === 'cairos' || rawText === 'ehi cairos' || rawText === 'ehi' || rawText === 'cairo' || rawText.length < 5;

                                if (isOnlyWakeWord && !isSessionActive) {
                                    replyText = "Dimmi pure, Alessandro.";
                                    ws.conversationHistory.push({ role: 'user', content: transcript });
                                    ws.conversationHistory.push({ role: 'assistant', content: replyText });
                                } else {
                                    ws.conversationHistory.push({ role: 'user', content: transcript });
                                    replyText = await getGroqChatResponse(ws.conversationHistory, ws.userName);
                                    
                                    // AGGIUNTA: Intercettazione e persistenza dei comandi MEMORIZZA:
                                    if (replyText.startsWith('MEMORIZZA:')) {
                                        const memoryContent = replyText.replace('MEMORIZZA:', '').trim();
                                        persistentMemory.push({ content: memoryContent, timestamp: new Date().toISOString() });
                                        savePersistedMemory(persistentMemory);
                                        console.log(`[MEMORIA PERSISTENTE SALVATA]: ${memoryContent}`);
                                    }

                                    ws.conversationHistory.push({ role: 'assistant', content: replyText });

                                    if (ws.conversationHistory.length > 10) {
                                        ws.conversationHistory = ws.conversationHistory.slice(-10);
                                    }
                                }
                            }

                            console.log(`[Elaborato] Risposta: "${replyText}" | Volume: ${currentVolume}%`);
                        }
                    } catch (err) {
                        console.error("[Errore IA]", err);
                        replyText = "Si è verificato un errore di elaborazione.";
                    }

                    if (!replyText) return;

                    ws.isSpeaking = true;
                    ws.send(JSON.stringify({ action: 'speak', text: replyText.trim() }));

                    sessionActiveUntil = Date.now() + 600000; // Esteso a 10 minuti di sicurezza durante i discorsi lunghi

                    try {
                        const textChunks = splitTextIntoChunks(replyText, 150);
                        
                        for (let chunk of textChunks) {
                            if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
                            
                            sessionActiveUntil = Date.now() + 600000;
                            
                            const pcmPart = await getSingleTtsPcm(chunk, currentVolume);
                            
                            if (pcmPart && pcmPart.length > 0) {
                                const chunkSize = 4096;
                                for (let i = 0; i < pcmPart.length; i += chunkSize) {
                                    if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
                                    
                                    while (ws.bufferedAmount > 65536) {
                                        await new Promise(resolve => setTimeout(resolve, 20));
                                        if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
                                    }
                                    
                                    ws.send(pcmPart.subarray(i, i + Math.min(chunkSize, pcmPart.length - i)), { binary: true });
                                }
                            }
                            await new Promise(resolve => setTimeout(resolve, 300));
                        }

                        if (ws.isSpeaking) {
                            console.log("[WS] Streaming audio completato.");
                            if (ws.readyState === ws.OPEN) {
                                ws.send(JSON.stringify({ action: 'stop' }));
                            }
                        }
                        ws.isSpeaking = false;
                        
                        sessionActiveUntil = Date.now() + SESSION_DURATION_MS;

                    } catch (streamErr) {
                        console.error("[Errore Streaming Audio]", streamErr);
                        ws.isSpeaking = false;
                    }
                }
            } catch (e) {
                console.log('[WS Testo]', message.toString());
            }
        }
    });

    ws.on('close', () => {
        clearInterval(pingInterval);
        ws.isSpeaking = false;
        if (ws.deviceMac && activeClients.get(ws.deviceMac) === ws) {
            activeClients.delete(ws.deviceMac);
            console.log(`Dispositivo con MAC ${ws.deviceMac} disconnesso.`);
        }
        if (activeWsClient === ws) activeWsClient = null;
        console.log("[WS] Connessione chiusa.");
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server Kairós in ascolto sulla porta ${PORT}`);
});
