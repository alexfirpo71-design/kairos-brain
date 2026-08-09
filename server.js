import http, { createServer } from 'http';
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
    const systemPrompt = `Kairós, l'assistente IA di Alessandro Firpo.
Sei un'IA avanzata e amichevole, il tuo tono è colloquiale e diretto.
TUTTO IL TUO MONDO È QUI:
- Alessandro: 55 anni, perito elettronico a Genova.
- Famiglia: la figlia Margot (talentuosa nel disegno), la compagna Tiziana (separata con due figli), papà Lino.
- Memoria: la mamma Elviana (passata a miglior vita il 24/12/2024), la gatta Prugna (venuta a mancare nel maggio 2026, sepolta in giardino).
- Affetti domestici: Miele (cane), Lulù e Isalide (gatti/coniglio).
- Interessi: restauro retrogaming, simulazione volo (Airbus A320neo), droni, fotografia analogica, spazio/astronomia.
- Progetti: Kairós (sistema di memoria), cabina al campeggio di Carasco.
- Rispondi sempre tenendo conto di questo contesto se interpellato, sii cordiale e tratta la sua famiglia con rispetto.`;

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
    console.log("[Camera] Richiesta cattura immagine all'ESP32...");
    
    try {
        const imageBuffer = await new Promise((resolve, reject) => {
            ws.pendingVisionRequest = true;
            ws.visionResolve = resolve;
            ws.visionReject = reject;
            ws.imageBuffer = [];

            ws.send(JSON.stringify({ action: 'capture_image' }));

            setTimeout(() => {
                if (ws.pendingVisionRequest) {
                    ws.pendingVisionRequest = false;
                    reject(new Error("Timeout: l'ESP32 non ha inviato l'immagine."));
                }
            }, 10000);
        });

        const base64Image = imageBuffer.toString('base64');
        const apiKey = process.env.GROQ_API_KEY;
        
        const visionResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.2-11b-vision-preview',
                messages: [
                    {
                        role: 'system',
                        content: 'Sei il sistema Vision di Kairós. Trascrivi il testo leggibile.'
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Leggi il testo visibile.' },
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                        ]
                    }
                ],
                max_tokens: 50,
                temperature: 0.0
            })
        });

        if (!visionResponse.ok) throw new Error(`Errore Vision API: ${visionResponse.status}`);
        const visionData = await visionResponse.json();
        return `Sul biglietto c'è scritto: ${visionData.choices[0].message.content.trim()}`;
    } catch (err) {
        console.error("[Errore Camera]", err.message);
        return "Non sono riuscito ad accedere alla telecamera.";
    }
}

wss.on('connection', (ws, req) => {
    ws.userName = "Alessandro";
    ws.conversationHistory = [];
    ws.isSpeaking = false;
    let audioBuffer = [];
    ws.pendingVisionRequest = false;

    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            if (ws.pendingVisionRequest) {
                ws.imageBuffer.push(message);
                const completeImageBuffer = Buffer.concat(ws.imageBuffer);
                ws.imageBuffer = [];
                ws.pendingVisionRequest = false;
                if (ws.visionResolve) ws.visionResolve(completeImageBuffer);
            } else {
                audioBuffer.push(message);
            }
        } else {
            try {
                const data = JSON.parse(message.toString());
                if (data.action === 'stop') {
                    ws.isSpeaking = false;
                    audioBuffer = [];
                    return;
                }
                
                if (data.state === 'processing') {
                    const completeAudioBuffer = Buffer.concat(audioBuffer);
                    audioBuffer = [];

                    let replyText = "Ricevuto.";
                    try {
                        const transcript = await transcribeAudio(completeAudioBuffer);
                        if (transcript) {
                            ws.conversationHistory.push({ role: 'user', content: transcript });
                            replyText = await getGroqChatResponse(ws.conversationHistory, ws.userName);
                            ws.conversationHistory.push({ role: 'assistant', content: replyText });
                        }
                    } catch (err) {
                        replyText = "Errore di elaborazione.";
                    }

                    ws.isSpeaking = true;
                    ws.send(JSON.stringify({ action: 'speak', text: replyText }));

                    const textChunks = splitTextIntoChunks(replyText, 150);
                    for (let chunk of textChunks) {
                        if (!ws.isSpeaking) break;
                        const pcmPart = await getSingleTtsPcm(chunk, currentVolume);
                        if (pcmPart) {
                            for (let i = 0; i < pcmPart.length; i += 4096) {
                                if (!ws.isSpeaking) break;
                                ws.send(pcmPart.subarray(i, i + 4096), { binary: true });
                            }
                        }
                    }
                    ws.isSpeaking = false;
                }
            } catch (e) { console.log('Errore WebSocket:', e); }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server Kairós attivo su porta ${PORT}`));
