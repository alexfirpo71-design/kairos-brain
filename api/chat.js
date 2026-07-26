export default async function handler(req, res) {
    try {
        const sampleRate = 8000;
        const durationSeconds = 1.0; 
        const frequency = 600; // Frequenza leggermente più alta e pulita
        const numSamples = sampleRate * durationSeconds;
        
        const buffer = Buffer.alloc(numSamples * 2);
        
        for (let i = 0; i < numSamples; i++) {
            const t = i / sampleRate;
            // Applichiamo un inviluppo (fade-in / fade-out) per evitare il "click" iniziale e finale
            let envelope = 1.0;
            if (t < 0.1) envelope = t / 0.1;
            if (t > durationSeconds - 0.1) envelope = (durationSeconds - t) / 0.1;

            const sample = Math.sin(2 * Math.PI * frequency * t) * envelope;
            const intSample = Math.floor(sample * 10000); // Volume ridotto per evitare distorsioni
            buffer.writeInt16LE(intSample, i * 2);
        }

        res.setHeader('Content-Type', 'audio/l16; rate=8000');
        return res.status(200).send(buffer);

    } catch (error) {
        console.error("Errore critico:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
