import { GoogleGenAI } from '@google/genai';
import { Buffer } from 'buffer';
import fetch from 'node-fetch';
import { spawn } from 'child_process';

export const config = {
    api: {
        bodyParser: false,
    },
};

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Funzione helper per convertire MP3 (Google TTS) in PCM grezzo 16kHz per l'ESP32
async function convertMp3ToPcm(mp3Buffer) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', 'pipe:0',
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
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).json({ status: "Kairós API Online" });
    }

    try {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        const rawAudioBuffer = Buffer.concat(chunks);

        if (rawAudioBuffer.length === 0) {
            return res.status(400).json({ error: 'Audio buffer is empty' });
        }

        // Aggiungiamo l'header WAV per fare in modo che Gemini legga correttamente il PCM grezzo dell'ESP32
        const dataLength = rawAudioBuffer.length;
        const fileLength = dataLength + 36;
        const wavHeader = Buffer.from([
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
        const wavBuffer = Buffer.concat([wavHeader, rawAudioBuffer]);

        console.log("Audio ricevuto dall'ESP32, invio a Gemini...");

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                data: wavBuffer.toString('base64'),
                                mimeType: 'audio/wav',
                            },
                        },
                        {
                            text: 'Ascolta questo messaggio audio e rispondi in modo sintetico e diretto (massimo 2 frasi). Ricorda che il tuo nome si scrive Kairós.',
                        },
                    ],
                },
            ],
        });

        const replyText = response.text || "Ricevuto.";
        console.log(`[Kairós AI] Risposta generata: "${replyText}"`);

        const encodedText = encodeURIComponent(replyText.substring(0, 200));
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=it&client=tw-ob`;

        const ttsResponse = await fetch(ttsUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        if (!ttsResponse.ok) {
            throw new Error('TTS request failed');
        }

        const ttsArrayBuffer = await ttsResponse.arrayBuffer();
        const mp3Buffer = Buffer.from(ttsArrayBuffer);

        // CONVERSIONE CRITICA: Trasformiamo l'MP3 di Google in PCM grezzo s16le leggibile dall'ESP32
        const pcmBuffer = await convertMp3ToPcm(mp3Buffer);

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', pcmBuffer.length);
        console.log('[Kairós AI] Invio streaming audio PCM all ESP32 completato.');
        return res.status(200).send(pcmBuffer);

    } catch (error) {
        console.error("Errore server:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
