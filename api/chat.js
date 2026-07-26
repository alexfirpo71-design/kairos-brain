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

        // Per adesso, usiamo una risposta fissa o l'SDK di Gemini configurato correttamente sui chunk audio
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: "Ascolta l'audio dell'utente e rispondi in modo sintetico in italiano." },
                        {
                            inlineData: {
                                mimeType: 'audio/pcm',
                                data: audioBuffer.toString('base64')
                            }
                        }
                    ]
                }
            ],
        });

        const replyText = response.text || "Ricevuto.";
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(replyText)}&tl=it&client=tw-ob`;
        
        const ttsResponse = await fetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const ttsAudioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

        res.setHeader('Content-Type', 'audio/mpeg');
        return res.status(200).send(ttsAudioBuffer);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
