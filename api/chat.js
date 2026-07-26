export default async function handler(req, res) {
    try {
        const text = "Il sistema Kairos e online e operativo.";
        const encodedText = encodeURIComponent(text);
        
        // Usiamo l'URL diretto per il flusso audio di Google TTS
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=it&client=tw-ob`;

        const ttsResponse = await fetch(ttsUrl);
        if (!ttsResponse.ok) {
            throw new Error("Errore nel recupero dell'audio da Google");
        }

        const arrayBuffer = await ttsResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.setHeader('Content-Type', 'audio/mpeg');
        return res.send(buffer);

    } catch (error) {
        console.error("Errore:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
