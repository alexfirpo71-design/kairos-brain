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

// Mappa globale per la cronologia persistente basata sul MAC
const sessionHistories = new Map();

// Gestione globale del volume (valore percentuale da 0 a 100, default 70)
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
        const cleanText = encodeURIComponent(textChunk);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${cleanText}&tl=it&client=tw-ob`;
        
        const response = await fetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        if (!response.ok) throw new Error(`Errore TTS HTTP: ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        const mp3Buffer = Buffer.from(arrayBuffer);

        // Calcola il guadagno audio (volume) in base alla percentuale (da 0.1 a 2.0)
        const volumeFactor = Math.max(0.05, volumePercent / 70);

        const pcmBuffer = await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', 'pipe:0',
                '-af', `volume=${volumeFactor},atempo=1.15,equalizer=f=300:width_type=o:width=2:g=3,equalizer=f=3000:width_type=o:width=2:g=-2,acompressor=threshold=-18dB:ratio=3:attack=5:release=50`,
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

        const silenceSamples = 8000; 
        let paddedPcmBuffer = Buffer.concat([pcmBuffer, Buffer.alloc(silenceSamples * 2)]);

        const fadeSamplesIn = Math.min(240, paddedPcmBuffer.length / 2);
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
    const systemPrompt = `Sei Kairós, l'assistente IA avanzato di ${userName}. 
Parli sempre in italiano in modo diretto, esaustivo ma senza eccessive lungaggini. 
Ricordi i messaggi precedenti e il profilo dell'utente (55 anni, perito elettronico, sales representative a Genova, figlia Margot, fidanzata Tiziana, gatti Lulù e Matti, coniglio Isalide, cane Miele, passioni per retrogaming, flight simulation e cucina tecnica).`;

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

wss.on('connection', (ws, req) => {
    console.log(`[WS] Connesso da: ${req.socket.remoteAddress}`);
    ws.userName = "Alessandro";
    ws.conversationHistory = [];
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
                    console.log("[WS] Ricevuto comando di stop manuale/remoto.");
                    audioBuffer = [];
                    return;
                }

                if (data.user) {
                    ws.userName = data.user;
                }

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
                            const lowerTranscript = transcript.toLowerCase().trim();

                            // Gestione Comando STOP vocale
                            if (lowerTranscript === 'stop' || lowerTranscript === 'fermati' || lowerTranscript === 'basta') {
                                replyText = "Fatto.";
                                ws.send(JSON.stringify({ action: 'stop', state: 'idle', text: replyText }));
                                return;
                            }

                            // Gestione Comandi Volume Vocali
                            if (lowerTranscript.includes('alza il volume') || lowerTranscript.includes('più alto')) {
                                currentVolume = Math.min(100, currentVolume + 15);
                                replyText = `Volume impostato al ${currentVolume} percento.`;
                            } else if (lowerTranscript.includes('abbassa il volume') || lowerTranscript.includes('più basso')) {
                                currentVolume = Math.max(10, currentVolume - 15);
                                replyText = `Volume impostato al ${currentVolume} percento.`;
                            } else {
                                ws.conversationHistory.push({ role: 'user', content: transcript });
                                replyText = await getGroqChatResponse(ws.conversationHistory, ws.userName);
                                ws.conversationHistory.push({ role: 'assistant', content: replyText });

                                if (ws.conversationHistory.length > 10) {
                                    ws.conversationHistory = ws.conversationHistory.slice(-10);
                                }
                            }

                            console.log(`[Llama/Command] Risposta: "${replyText}" (Volume: ${currentVolume}%)`);
                        }
                    } catch (err) {
                        console.error("[Errore IA]", err);
                        replyText = "Si è verificato un errore di elaborazione.";
                    }

                    ws.send(JSON.stringify({ action: 'speak', state: 'idle', text: replyText }));

                    try {
                        const textChunks = splitTextIntoChunks(replyText, 250);
                        
                        for (let chunk of textChunks) {
                            if (ws.readyState !== ws.OPEN) break;
                            const pcmPart = await getSingleTtsPcm(chunk, currentVolume);
                            if (pcmPart && pcmPart.length > 0) {
                                const chunkSize = 1024;
                                for (let i = 0; i < pcmPart.length; i += chunkSize) {
                                    if (ws.readyState !== ws.OPEN) break;
                                    
                                    if (ws.bufferedAmount > 16384) {
                                        await new Promise(resolve => setTimeout(resolve, 30));
                                    }
                                    
                                    ws.send(pcmPart.subarray(i, i + chunkSize));
                                }
                                await new Promise(resolve => setTimeout(resolve, 10));
                            }
                        }

                        console.log("[WS] Streaming audio completato. Invio stop all'ESP32.");
                        
                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({ action: 'stop' }));
                        }

                    } catch (streamErr) {
                        console.error("[Errore Streaming Audio]", streamErr);
                    }
                }
            } catch (e) {
                console.log('[WS Testo]', message.toString());
            }
        }
    });

    ws.on('close', () => {
        clearInterval(pingInterval);
        console.log("[WS] Connessione chiusa.");
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server Kairós in ascolto sulla porta ${PORT}`);
});
