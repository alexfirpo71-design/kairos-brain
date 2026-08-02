import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';

const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Kairos Brain Server is running!\n');
});

const wss = new WebSocketServer({ server, path: '/ws' });

// Funzione per generare l'intestazione WAV per i dati PCM grezzi dell'ESP32
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

// Funzione per inviare l'audio a Groq Whisper API
async function transcribeAudio(audioBuffer) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error("GROQ_API_KEY non configurata nelle variabili d'ambiente.");
    }

    const wavBuffer = addWavHeader(audioBuffer);

    const formData = new FormData();
    formData.append('file', wavBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav',
    });
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'it');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            ...formData.getHeaders()
        },
        body: formData
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Errore API Groq Whisper: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.text;
}

// Funzione per interrogare il modello LLM di Groq integrando il contesto hardware live
async function getGroqChatResponse(userText, userName = "Alessandro", deviceContext = "") {
    const apiKey = process.env.GROQ_API_KEY;

    const systemPrompt = `Sei Kairós, un assistente IA vocale avanzato integrato in un dispositivo hardware ESP32-S3 (Freenove). Stai parlando con ${userName}, un perito elettronico e sviluppatore che vive a Valbrevenna. 
Stato e contesto tecnico attuale del progetto su cui state lavorando in tempo reale: "${deviceContext || 'Nessun dettaglio aggiuntivo.'}"
Rispondi in modo diretto, brillante, amichevole, tecnico e competente in lingua italiana, tenendo sempre a mente i progressi hardware fatti. Sii sintetico (massimo 2 frasi) per facilitare la sintesi vocale.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userText }
            ],
            max_tokens: 150
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Errore API Groq Chat: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Funzione per generare l'audio parlato (TTS) tramite le API di Groq
async function textToSpeech(text) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error("GROQ_API_KEY non configurata.");
    }

    const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'canopylabs/orpheus-v1-english', // Modello TTS ufficiale su Groq
            input: text,
            voice: 'austin', // Voce maschile pulita
            response_format: 'wav'
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Errore Groq TTS: ${response.status} - ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const fullWavBuffer = Buffer.from(arrayBuffer);

    // Tagliamo l'intestazione WAV (solitamente i primi 44 byte) per inviare all'ESP32 solo i campioni PCM puri che si aspettava
    const pcmDataOnly = fullWavBuffer.subarray(44);
    return pcmDataOnly;
}

wss.on('connection', (ws, req) => {
    console.log(`[WS] Dispositivo ESP32 connesso con successo da: ${req.socket.remoteAddress}`);
    
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
                console.log('[WS] Ricevuto pacchetto JSON:', data);

                if (data.mac || data.context) {
                    if (data.mac) ws.deviceMac = data.mac;
                    if (data.user) ws.userName = data.user;
                    if (data.context) ws.deviceContext = data.context;
                    console.log(`[WS] Dispositivo registrato - MAC: ${ws.deviceMac}, Utente: ${ws.userName}`);
                    return; 
                }

                if (data.state === 'processing') {
                    const totalBytes = audioBuffer.reduce((acc, chunk) => acc + chunk.length, 0);
                    console.log(`[WS] Elaborazione audio completata. Chunk: ${audioBuffer.length}, Byte: ${totalBytes}`);

                    const completeAudioBuffer = Buffer.concat(audioBuffer);
                    let replyText = "Ricevuto.";

                    try {
                        console.log("[Groq] Invia audio a Whisper...");
                        const transcript = await transcribeAudio(completeAudioBuffer);
                        console.log(`[Groq] Trascrizione: "${transcript}"`);

                        if (transcript && transcript.trim().length > 0) {
                            console.log("[Groq] Generazione risposta LLM con contesto...");
                            replyText = await getGroqChatResponse(transcript, ws.userName, ws.deviceContext);
                            console.log(`[Groq] Risposta LLM: "${replyText}"`);
                        } else {
                            replyText = "Non ho udito alcun messaggio chiaro.";
                        }
                    } catch (apiError) {
                        console.error("[Groq] Errore durante l'elaborazione IA:", apiError);
                        replyText = "Errore di elaborazione sul server Kairós.";
                    }

                    const responsePayload = JSON.stringify({
                        action: 'speak',
                        state: 'idle',
                        text: replyText
                    });

                    ws.send(responsePayload);

                    // Generazione e invio della voce reale tramite TTS di Groq
                    try {
                        console.log("[Groq TTS] Conversione testo in voce...");
                        const ttsAudioBuffer = await textToSpeech(replyText);
                        
                        setTimeout(() => {
                            ws.send(ttsAudioBuffer);
                            console.log("[WS] Inviati dati audio vocali binari all'ESP32.");
                        }, 100);
                    } catch (ttsError) {
                        console.error("[Groq TTS] Errore nella sintesi vocale:", ttsError);
                    }

                    audioBuffer = [];
                }
            } catch (e) {
                console.log('[WS] Messaggio di testo ricevuto:', message.toString());
            }
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`[WS] Disconnesso. Codice: ${code}, Motivo: ${reason.toString()}`);
    });

    ws.on('error', (error) => {
        console.error('[WS] Errore WebSocket:', error);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server in ascolto sulla porta ${PORT}`);
});
