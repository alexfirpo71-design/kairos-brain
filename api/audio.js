import { Buffer } from 'buffer';
import fetch from 'node-fetch';
import { spawn } from 'child_process';

export const config = {
    api: {
        bodyParser: false,
    },
};

// Funzione per la chat testuale con Groq (Llama)
async function getGroqChatResponse(messages) {
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile', // Sostituisci con 'llama-3.1-8b-instant' se vuoi più velocità
            messages: messages,
            max_tokens: 4000,
            temperature: 0.7
        })
    });

    if (!groqResponse.ok) {
        const errData = await groqResponse.text();
        throw new Error(`Errore API Groq: ${groqResponse.status} - ${errData}`);
    }

    const data = await groqResponse.json();
    return data.choices[0]?.message?.content || '';
}

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

        console.log("Audio ricevuto dall'ESP32, invio a Llama (tramite Groq)...");

        // Costruiamo i messaggi per Llama
        const messages = [
            {
                role: 'system',
                content: 'Sei Kairós, un assistente IA integrato in un dispositivo hardware. Rispondi in modo sintetico e diretto (massimo 2 frasi).'
            },
            {
                role: 'user',
                content: 'L\'utente ha inviato un comando vocale tramite hardware. (Nota: l\'elaborazione audio diretta richiede trascrizione, gestisci il flusso della conversazione).'
            }
        ];

        const replyText = await getGroqChatResponse(messages);
        const finalReply = replyText || "Ricevuto.";
        console.log(`[Kairós Llama] Risposta generata: "${finalReply}"`);

        const encodedText = encodeURIComponent(finalReply.substring(0, 200));
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

        // Conversione da MP3 di Google a PCM grezzo s16le per l'ESP32
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
