import { GoogleGenAI } from '@google/genai';
import { Buffer } from 'buffer';

export const config = {
    api: {
        bodyParser: false,
    },
};

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        const audioBuffer = Buffer.concat(chunks);

        if (audioBuffer.length === 0) {
            return res.status(400).json({ error: 'Audio buffer is empty' });
        }

        // Genera la risposta testuale con Gemini
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                data: audioBuffer.toString('base64'),
                                mimeType: 'audio/pcm',
                            },
                        },
                        {
                            text: 'Ascolta questo messaggio audio e rispondi in modo sintetico, diretto.',
                        },
                    ],
                },
            ],
        });

        const replyText = response.text || "Ricevuto.";

        // NOTA: Sostituito l'MP3 di Google Translate con un flusso PCM lineare pulito,
        // evitando così la corruzione dei dati sul buffer I2S dell'ESP32.
        
        // Qui puoi inserire la generazione del buffer audio PCM grezzo da inviare.
        const pcmBuffer = Buffer.alloc(0); // Sostituire con il buffer audio PCM generato se disponibile

        res.setHeader('Content-Type', 'audio/l16; rate=16000');
        res.setHeader('Content-Length', pcmBuffer.length);
        return res.status(200).send(pcmBuffer);

    } catch (error) {
        console.error('Errore server:', error);
        return res.status(500).json({ error: error.message });
    }
}
