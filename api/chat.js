export default async function handler(req, res) {
    try {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            throw new Error("GROQ_API_KEY mancante.");
        }

        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: "Il sistema Kairós è online. Rispondi con una conferma." }]
                }]
            })
        });

        const data = await geminiRes.json();
        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || "Kairós operativo.";

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
