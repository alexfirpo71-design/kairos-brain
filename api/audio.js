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

        // Invio dell'audio a Gemini per la generazione della risposta testuale
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

        const replyText = response.text;

        // Generiamo l'audio TTS della risposta di Gemini tramite Google Translate TTS
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(replyText)}&tl=it&client=tw-ob`;
        
        const ttsResponse = await fetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (!ttsResponse.ok) {
            throw new Error(`Errore TTS: ${ttsResponse.statusText}`);
        }

        const ttsAudioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-cache');
        return res.status(200).send(ttsAudioBuffer);

    } catch (error) {
        console.error('Errore server:', error);
        return res.status(500).json({ error: error.message });
    }
}
