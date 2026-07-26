export default async function handler(req, res) {
    try {
        const sampleRate = 16000;
        const durationSeconds = 2.0; // Durata dell'audio
        const numSamples = Math.floor(sampleRate * durationSeconds);
        const dataSize = numSamples * 2; // 16-bit mono = 2 bytes per sample
        const chunkSize = 36 + dataSize;

        const buffer = Buffer.alloc(44 + dataSize);

        // --- HEADER WAV (RIFF) ---
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(chunkSize, 4);
        buffer.write('WAVE', 8);
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16);          // SubChunk1Size (16 per PCM)
        buffer.writeUInt16LE(1, 20);           // AudioFormat (1 = PCM)
        buffer.writeUInt16LE(1, 22);           // NumChannels (1 = Mono)
        buffer.writeUInt32LE(sampleRate, 24);  // SampleRate
        buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
        buffer.writeUInt16LE(2, 32);           // BlockAlign
        buffer.writeUInt16LE(16, 34);          // BitsPerSample (16-bit)
        buffer.write('data', 38);
        buffer.writeUInt32LE(dataSize, 42);

        // --- GENERAZIONE CAMPIONI PCM PULITI ---
        // Creiamo una modulazione vocale/armonica pulita (senza gracchii o pernacchie)
        const freq1 = 300;
        const freq2 = 600;

        for (let i = 0; i < numSamples; i++) {
            const t = i / sampleRate;
            // Invviluppo per evitare click all'inizio e alla fine
            let env = 1.0;
            if (t < 0.1) env = t / 0.1;
            if (t > durationSeconds - 0.1) env = (durationSeconds - t) / 0.1;

            const sample = (Math.sin(2 * Math.PI * freq1 * t) * 0.5 + Math.sin(2 * Math.PI * freq2 * t) * 0.5) * env;
            const intSample = Math.floor(sample * 10000);
            buffer.writeInt16LE(intSample, 44 + (i * 2));
        }

        res.setHeader('Content-Type', 'audio/wav');
        return res.status(200).send(buffer);

    } catch (error) {
        console.error("Errore:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
