import { Buffer } from 'buffer';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        
        // Risposta fissa di test per isolare l'audio e verificare la cassa senza frastuono
        const aiResponseText = "Kairós è perfettamente online."; 

        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(aiResponseText)}&tl=it&client=tw-ob`;
        
        const ttsResponse = await fetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (!ttsResponse.ok) {
            throw new Error(`Errore TTS: ${ttsResponse.statusText}`);
        }

        const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

        // Inviamo l'audio pulito
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.status(200).send(audioBuffer);

    }acha (error) {
        console.error('Errore:', error);
        res.status(500).json({ error: error.message });
    }
}
