export default async function handler(req, res) {
    try {
        const apiKey = process.env.GROQ_API_KEY; // Usa la chiave configurata su Vercel
        if (!apiKey) {
            throw new Error("API_KEY mancante.");
        }

        // 1. Interroghiamo Gemini per avere la risposta testuale di Kairós
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: "Il sistema Kairós è online e operativo." }]
                }]
            })
        });

        const data = await geminiRes.json();
        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || "Kairós operativo.";

        // 2. Per evitare le pernacchie dei formati compressi, generiamo un segnale PCM 
        // modulato sulla base della lunghezza del testo (un pattern acustico pulito e dinamico)
        const sampleRate = 8000;
        const durationPerChar = 0.08; // Durata dinamica in base al testo
        const totalDuration = Math.max(1.0, replyText.length * durationPerChar);
        const numSamples = Math.floor(sampleRate * totalDuration);
        
        const buffer = Buffer.alloc(numSamples * 2);
        const frequency = 550; // Frequenza del beep pulito

        for (let i = 0; i < numSamples; i++) {
            const t = i / sampleRate;
            
            // Effetto envelope per evitare click metallici all'inizio/fine
            let envelope = 1.0;
            if (t < 0.05) envelope = t / 0.05;
            if (t > totalDuration - 0.05) envelope = (totalDuration - t) / 0.05;

            // Moditichiamo leggermente la sinusoide per renderla più piacevole
            const sample = Math.sin(2 * Math.PI * frequency * t) * envelope;
            const intSample = Math.floor(sample * 12000); 
            buffer.writeInt16LE(intSample, i * 2);
        }

        // Restituiamo il flusso PCM pulito che l'ESP32 suona alla perfezione
        res.setHeader('Content-Type', 'audio/l16; rate=8000');
        return res.status(200).send(buffer);

    } catch (error) {
        console.error("Errore critico:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
