export default async function handler(req, res) {
    try {
        // Generiamo un buffer PCM grezzo di prova (onda sinusoidale o silenzio/tono)
        // L'ESP32 lo leggerà con i2s_write senza fare "pernacchie"
        const sampleRate = 16000;
        const durationSeconds = 2; // Durata di 2 secondi
        const numSamples = sampleRate * durationSeconds;
        const buffer = Buffer.alloc(numSamples * 2); // 16-bit per sample (2 bytes)

        // Creiamo un semplice tono udibile (es. 440 Hz) per testare l'altoparlante
        const frequency = 440; 
        for (let i = 0; i < numSamples; i++) {
            const t = i / sampleRate;
            const sample = Math.sin(2 * Math.PI * frequency * t) * 16383; // Metodo volume
            buffer.writeInt16LE(Math.floor(sample), i * 2);
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        return res.send(buffer);

    } catch (error) {
        console.error("Errore:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
