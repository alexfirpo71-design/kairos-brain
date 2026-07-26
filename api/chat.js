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
        // Lettura dello stream binario con Promise ed eventi standard
        const audioBuffer = await new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', (err) => reject(err));
        });

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: "Conferma ricezione audio con una frase breve." }] }],
        });

        const replyText = response.text || "Sistema Kairós online.";
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(replyText)}&tl=it&client=tw-ob`;
        
        const ttsResponse = await fetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (!ttsResponse.ok) {
            throw new Error(`Errore TTS esterno: ${ttsResponse.status}`);
        }

        const ttsAudioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

        res.setHeader('Content-Type', 'audio/mpeg');
        return res.status(200).send(ttsAudioBuffer);

    } catch (error) {
        console.error("Errore server:", error);
        return res.status(500).json({ error: error.message });
    }
}
