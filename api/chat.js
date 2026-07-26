export default async function handler(req, res) {
    try {
        // Test diretto: genera un TTS pulito con una frase fissa per sbloccare la cassa
        const replyText = "Sistema Kairós online e operativo.";
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(replyText)}&tl=it&client=tw-ob`;
        
        const ttsResponse = await fetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (!ttsResponse.ok) {
            throw new Error(`Errore TTS: ${ttsResponse.status}`);
        }

        const ttsAudioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

        res.setHeader('Content-Type', 'audio/mpeg');
        return res.status(200).send(ttsAudioBuffer);

    } catch (error) {
        console.error("Errore critico:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
