import { Buffer } from 'buffer';

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    if (req.method === 'GET') {
        const testText = "Test audio Kairós superato con successo.";
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(testText)}&tl=it&client=tw-ob`;
        
        const ttsResponse = await fetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const ttsAudioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
        res.setHeader('Content-Type', 'audio/mpeg');
        return res.status(200).send(ttsAudioBuffer);
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
