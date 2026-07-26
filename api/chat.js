export default async function handler(req, res) {
    try {
        const text = "Il sistema Kairós è online e operativo.";
        const encodedText = encodeURIComponent(text);
        
        // Sfruttiamo il TTS di Google Translate in formato mp3/stream pulito
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=it&client=tw-ob`;
        
        const ttsResponse = await fetch(ttsUrl);
        if (!ttsResponse.ok) {
            throw new Error("Errore nel recupero dell'audio da Google Translate");
        }

        const audioBuffer = await ttsResponse.arrayBuffer();

        res.setHeader('Content-Type', 'audio/mpeg');
        return res.status(200).send(Buffer.from(audioBuffer));

    } catch (error) {
        console.error("Errore critico:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
