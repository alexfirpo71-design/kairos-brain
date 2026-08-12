import http, { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { spawn } from 'child_process';

const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/upload') {
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
                                content: 'Sei Kairós, l assistente di Alessandro. L ESP32 ha appena inviato uno scatto dalla telecamera. Rispondi SEMPRE ed esclusivamente in lingua italiana, descrivendo sia il testo scritto sul foglietto sia ciò che si trova sotto o intorno ad esso, in modo chiaro e naturale.'
                            },
                            {
                                role: 'user',
                                content: [
                                    { type: 'text', text: 'Trascrivi il testo scritto sul foglietto e descrivi dettagliatamente cosa c e sotto o intorno al foglietto in italiano.' },
                                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` } }
                                ]
                            }
                        ],
                        max_tokens: 300,
                        temperature: 0.0
                    })
                });

                if (!visionResponse.ok) {
                    const errorBody = await visionResponse.text();
                    console.error(`[Errore Dettagliato Groq] Status: ${visionResponse.status} - Body: ${errorBody}`);
                    throw new Error(`Errore API: ${visionResponse.status}`);
                }
                const visionData = await visionResponse.json();
                let resultText = visionData.choices[0].message.content.trim();
                
                console.log(`[Risposta Monitor] "${resultText}"`);
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`Immagine ricevuta ed elaborata con successo: ${resultText}`);

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
        const speechFriendlyText = textChunk
            .replace(/Kairós|Kairos|Kairòs/gi, 'Cairos');

        const sanitizedText = speechFriendlyText
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
    const systemPrompt = `Kairós, l'assistente IA avanzato di ${userName}. 
Parli sempre in italiano in modo diretto, deciso ma senza eccessive lungaggini e solo quando viene richiesto.
CONTESTO PRIVATO (da usare ESCLUSIVAMENTE se l'utente ti fa domande dirette in merito, non menzionarlo mai di tua spontanea volontà):
- L'utente ha 55 anni e si chiama Alessandro, è un perito elettronico a Genova.
- Famiglia e affetti: la figlia Margot, la fidanzata Tiziana, papà Lino, mamma Elviana mancata il 24 dicembre 2024, i gatti Lulù, il coniglio Isalide, il cane Miele, e la gatta Prugna mancata l'11 maggio 2026.
- Passioni tecniche: retrogaming, flight simulation, pilota di drone.`;

    const messages = [{ role: 'system', content: systemPrompt }, ...conversationHistory];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: messages,
            max_tokens: 300,
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

async function handleCameraTrigger(ws) {
    const cameraUrl = "http://192.168.1.152:8080/shot.jpg";
    console.log("[Camera] Contattando la telecamera IP su comando vocale...");
    
    try {
        const imageBuffer = await new Promise((resolve, reject) => {
            const req = http.get(cameraUrl, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP error! status: ${res.statusCode}`));
                    return;
                }
                let chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => resolve(Buffer.concat(chunks)));
            });
            req.on('error', err => reject(err));
            req.setTimeout(5000, () => {
                req.destroy();
                reject(new Error("Timeout di connessione alla telecamera"));
            });
        });

        const apiKey = process.env.GROQ_API_KEY;
        const base64Image = imageBuffer.toString('base64');
        
        const visionResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen/qwen3.6-27b',
                messages: [
                    {
                        role: 'system',
                        content: 'Sei Kairós, un assistente vocale. Fornisci SEMPRE in lingua italiana una descrizione dettagliata sia del testo scritto sul foglietto sia di ciò che si trova sotto o intorno ad esso, pronta per essere letta a voce.'
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Trascrivi il testo scritto sul foglietto e descrivi cosa c e sotto o intorno al foglietto in italiano.' },
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                        ]
                    }
                ],
                max_tokens: 250,
                temperature: 0.0
            })
        });

        if (!visionResponse.ok) throw new Error(`Errore API Vision: ${visionResponse.status}`);
        
        const visionData = await visionResponse.json();
        const description = visionData.choices[0].message.content.trim();
        
        console.log(`[Camera Risposta Monitor] "${description}"`);
        return description;
    } catch (err) {
        console.error("[Errore Camera]", err.message);
        return "Non sono riuscito ad accedere alla telecamera.";
    }
}

wss.on('connection', (ws, req) => {
    console.log(`[WS] Connesso da: ${req.socket.remoteAddress}`);
    ws.userName = "Alessandro";
    ws.conversationHistory = [];
    ws.isSpeaking = false;
    let audioBuffer = [];

    // Finestra di dialogo estesa a 20 secondi per il botta e risposta continuo
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
            audioBuffer.push(message);
        } else {
            try {
                const data = JSON.parse(message.toString());
                
                if (data.action === 'stop') {
                    console.log("[WS] Comando di stop ricevuto dall'ESP32.");
                    ws.isSpeaking = false;
                    audioBuffer = [];
                    return;
                }

                if (data.user) ws.userName = data.user;

                if (data.mac) {
                    ws.mac = data.mac;
                    if (!sessionHistories.has(data.mac)) {
                        sessionHistories.set(data.mac, []);
                    }
                    ws.conversationHistory = sessionHistories.get(data.mac);
                }

                if (data.mac || data.device || data.user || data.location || data.status) {
                    return;
                }

                if (data.state === 'processing') {
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

                            // Tieni aperta la sessione per altri 20 secondi da questo momento
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
                                console.log("[WS] Intenzione telecamera rilevata. Scatto in corso...");
                                replyText = await handleCameraTrigger(ws);
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

                    // Estendiamo ulteriormente la sessione anche dal momento in cui l'assistente risponde
                    sessionActiveUntil = Date.now() + SESSION_DURATION_MS;

                    try {
                        const textChunks = splitTextIntoChunks(replyText, 150);
                        
                        for (let chunk of textChunks) {
                            if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
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
                        }

                        if (ws.isSpeaking) {
                            console.log("[WS] Streaming audio completato.");
                            if (ws.readyState === ws.OPEN) {
                                ws.send(JSON.stringify({ action: 'stop' }));
                            }
                        }
                        ws.isSpeaking = false;
                        
                        // Rinnova la sessione anche alla fine del playback audio
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
        console.log("[WS] Connessione chiusa.");
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server Kairós in ascolto sulla porta ${PORT}`);
});
