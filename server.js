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
Parli sempre in italiano in modo diretto, esaustivo ma senza eccessive lungaggini. 
CONTESTO PRIVATO (da usare ESCLUSIVAMENTE se l'utente ti fa domande dirette in merito, non menzionarlo mai di tua sponte):
- L'utente ha 55 anni, è un perito elettronico a Genova.
- Famiglia e affetti: la figlia Margot, la fidanzata Tiziana, i gatti Lulù, il coniglio Isalide, il cane Miele, e la gatta Prugna mancata l'11 maggio 2026.
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
    console.log("[Camera] Contattando la telecamera IP...");
    try {
        const camResponse = await fetch(cameraUrl, { timeout: 5000 });
        if (!camResponse.ok) throw new Error(`HTTP error! status: ${camResponse.status}`);
        
        const imageBuffer = await camResponse.buffer();
        const base64Image = imageBuffer.toString('base64');
        
        console.log("[Camera] Immagine catturata, invio a Groq Vision...");
        const apiKey = process.env.GROQ_API_KEY;
        
        const visionResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.2-11b-vision-preview',
                messages: [
                    {
                        role: 'user',
                        content: [
                            { 
                                type: 'text', 
                                text: 'Analizza questa foto con estrema precisione e descrivi unicamente ciò che vedi in modo oggettivo. Se non distingui bene i soggetti, l immagine è mossa o non capisci cosa c è, di semplicemente che non riesci a identificare chiaramente l immagine, senza inventare dettagli.' 
                            },
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                        ]
                    }
                ],
                max_tokens: 200,
                temperature: 0.1
            })
        });

        if (!visionResponse.ok) throw new Error(`Errore Vision API: ${visionResponse.status}`);
        const visionData = await visionResponse.json();
        return visionData.choices[0].message.content;
    } catch (err) {
        console.error("[Errore Camera/Vision]", err.message);
        return "Non sono riuscito a stabilire il collegamento con la telecamera o ad analizzare l'immagine.";
    }
}

wss.on('connection', (ws, req) => {
    console.log(`[WS] Connesso da: ${req.socket.remoteAddress}`);
    ws.userName = "Alessandro";
    ws.conversationHistory = [];
    ws.isSpeaking = false;
    let audioBuffer = [];

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

                if (data.action === 'trigger_camera') {
                    console.log("[WS] Azione trigger_camera ricevuta.");
                    ws.isSpeaking = true;
                    let replyText = await handleCameraTrigger(ws);
                    
                    ws.conversationHistory.push({ role: 'assistant', content: replyText });
                    ws.send(JSON.stringify({ action: 'speak', text: replyText }));

                    try {
                        const textChunks = splitTextIntoChunks(replyText, 150);
                        for (let chunk of textChunks) {
                            if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
                            const pcmPart = await getSingleTtsPcm(chunk, currentVolume);
                            if (pcmPart && pcmPart.length > 0) {
                                const chunkSize = 4096;
                                for (let i = 0; i < pcmPart.length; i += chunkSize) {
                                    if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
                                    while (ws.bufferedAmount > 32768) {
                                        await new Promise(resolve => setTimeout(resolve, 10));
                                        if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
                                    }
                                    ws.send(pcmPart.subarray(i, i + Math.min(chunkSize, pcmPart.length - i)), { binary: true });
                                }
                            }
                        }
                        if (ws.isSpeaking && ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({ action: 'stop' }));
                        }
                    } catch (streamErr) {
                        console.error("[Errore Streaming Camera Audio]", streamErr);
                    }
                    ws.isSpeaking = false;
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

                    let replyText = "Ricevuto.";
                    try {
                        const transcript = await transcribeAudio(completeAudioBuffer);
                        console.log(`[Whisper] Trascritto: "${transcript}"`);
                        
                        if (transcript && transcript.trim().length > 0) {
                            const rawText = transcript.toLowerCase().replace(/[.,\/$%\^&\*;:{}=\-_`~()?]/g, "").trim();

                            if (rawText.includes('stop') || rawText.includes('stopp') || rawText.includes('fermati') || rawText.includes('basta') || rawText.includes('silenzio')) {
                                ws.isSpeaking = false;
                                ws.send(JSON.stringify({ action: 'stop' }));
                                console.log("[Comando] Interruzione eseguita.");
                                return;
                            }

                            if (rawText.includes('alza') || rawText.includes('piu alto') || rawText.includes('più alto') || rawText.includes('volume su')) {
                                currentVolume = Math.min(100, currentVolume + 15);
                                replyText = `Volume al ${currentVolume} per cento.`;
                            } 
                            else if (rawText.includes('abbassa') || rawText.includes('piu basso') || rawText.includes('più basso') || rawText.includes('volume giu') || rawText.includes('volume giù')) {
                                currentVolume = Math.max(10, currentVolume - 15);
                                replyText = `Volume al ${currentVolume} per cento.`;
                            } 
                            else {
                                ws.conversationHistory.push({ role: 'user', content: transcript });
                                replyText = await getGroqChatResponse(ws.conversationHistory, ws.userName);
                                ws.conversationHistory.push({ role: 'assistant', content: replyText });

                                if (ws.conversationHistory.length > 10) {
                                    ws.conversationHistory = ws.conversationHistory.slice(-10);
                                }
                            }

                            console.log(`[Elaborato] Risposta: "${replyText}" | Volume: ${currentVolume}%`);
                        }
                    } catch (err) {
                        console.error("[Errore IA]", err);
                        replyText = "Si è verificato un errore di elaborazione.";
                    }

                    ws.isSpeaking = true;
                    ws.send(JSON.stringify({ action: 'speak', text: replyText }));

                    try {
                        const textChunks = splitTextIntoChunks(replyText, 150);
                        
                        for (let chunk of textChunks) {
                            if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
                            const pcmPart = await getSingleTtsPcm(chunk, currentVolume);
                            
                            if (pcmPart && pcmPart.length > 0) {
                                const chunkSize = 4096;
                                for (let i = 0; i < pcmPart.length; i += chunkSize) {
                                    if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
                                    
                                    while (ws.bufferedAmount > 32768) {
                                        await new Promise(resolve => setTimeout(resolve, 10));
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
