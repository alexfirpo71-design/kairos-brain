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
        return res.status(200).json({ status: "Kairós API Online" });
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

        console.log("Audio ricevuto dall'ESP32, invio a Gemini...");

        // Genera la risposta testuale con Gemini istruendo il modello sul nome corretto
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
                            text: 'Ascolta questo messaggio audio e rispondi in modo sintetico e diretto. Ricorda che il tuo nome si scrive Kairós.',
                        },
                    ],
                },
            ],
        });

        const replyText = response.text || "Ricevuto.";
        console.log(`[Kairós AI] Risposta generata: "${replyText}"`);

        // Per adesso, restituiamo il testo elaborato o un pacchetto di conferma pulito per l'ESP32
        // Nota: se l'ESP32 si aspetta PCM grezzo, qui dovremmo mappare il TTS, 
        // ma intanto restituiamo un JSON o un buffer vuoto sicuro finché non colleghi il TTS desiderato.
        return res.status(200).json({ reply: replyText });

    } catch (error) {
        console.error("Errore server:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
