export default async function handler(req, res) {
    try {
        // Generiamo un semplice tono audio sinusoidale pulito (PCM grezzo 16-bit mono a 8kHz)
        // In questo modo l'ESP32 lo suona direttamente senza fare "pernacchie" o richiedere decoder MP3.
        const sampleRate = 8000;
        const durationSeconds = 1.5; // Durata del tono: 1.5 secondi
        const frequency = 440; // Frequenza del tono (La4)
        const numSamples = sampleRate * durationSeconds;
        
        const buffer = Buffer.alloc(numSamples * 2); // 2 bytes per sample (16-bit)
        
        for (let i = 0; i < numSamples; i++) {
            const t = i / sampleRate;
            // Onda sinusoidale
            const sample = Math.sin(2 * Math.PI * frequency * t);
            // Converti in intero a 16 bit con segno (-32768 a 32767)
            const intSample = Math.floor(sample * 16383); 
            buffer.writeInt16LE(intSample, i * 2);
        }

        // Restituiamo il flusso PCM grezzo con intestazione corretta
        res.setHeader('Content-Type', 'audio/l16; rate=8000');
        return res.status(200).send(buffer);

    } catch (error) {
        console.error("Errore critico:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
