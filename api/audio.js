import { GoogleGenAI } from '@google/genai';
import { Buffer } from 'buffer';
import fetch from 'node-fetch';

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
        console.log(`[Elaborato] Risposta: "${replyText}"`);

        // Codifica il testo per la richiesta TTS di Google Translate (evitando errori 400 da caratteri speciali)
        const encodedText = encodeURIComponent(replyText.substring(0, 200));
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=it&client=tw-ob`;

        const ttsResponse = await fetch(ttsUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        if (!ttsResponse.ok) {
            console.error(`[Errore TTS Singolo] Errore TTS HTTP: ${ttsResponse.status}`);
            return res.status(400).json({ error: 'TTS request failed' });
        }

        const ttsArrayBuffer = await ttsResponse.arrayBuffer();
        const pcmBuffer = Buffer.from(ttsArrayBuffer);

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', pcmBuffer.length);
        console.log('[WS] Streaming audio completato.');
        return res.status(200).send(pcmBuffer);

    } catch (error) {
        console.error('Errore server:', error);
        return res.status(500).json({ error: error.message });
    }
}
