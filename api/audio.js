module.exports = async (req, res) => {
    try {
        // Generiamo un semplice buffer PCM di prova (un'onda sinusoidale/quadra fittizia)
        // così l'ESP32 riceve dati PCM grezzi palesi e li spara sullo speaker.
        const sampleRate = 16000;
        const durationSeconds = 1; // 1 secondo di beep
        const numSamples = sampleRate * durationSeconds;
        const buffer = Buffer.alloc(numSamples * 2); // 16-bit PCM

        for (let i = 0; i < numSamples; i++) {
            // Genera un'onda a 440 Hz (nota La)
            const sample = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 10000;
            buffer.writeInt16LE(Math.floor(sample), i * 2);
        }

        res.setHeader('Content-Type', 'audio/l16');
        res.send(buffer);

    } catch (error) {
        console.error("ERRORE:", error);
        res.status(500).send('Errore: ' + error.message);
    }
};
