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

        // Chiamata a Gemini per ottenere risposta testuale e audio nativo PCM se supportato,
        // oppure generazione diretta della risposta testuale da rimandare all'ESP32.
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

        // Per adesso restituiamo il testo formattato o un payload PCM pulito
        // Evitiamo il passaggio MP3 di Google Translate che sballa l'I2S dell'ESP32.
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json({ 
            status: "ok", 
            text: replyText 
        });

    } catch (error) {
        console.error('Errore server:', error);
        return res.status(500).json({ error: error.message });
    }
}
