import { GoogleGenAI } from '@google/genai';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY non configurata nelle variabili d'ambiente di Vercel.");
        }

        const ai = new GoogleGenAI({ apiKey: apiKey });

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: "Rispondi solo con: Sistema Kairós operativo." }] }],
        });

        const replyText = response.text || "Sistema Kairós operativo.";
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
        console.error("Dettaglio errore server:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
