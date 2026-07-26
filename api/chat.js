export default async function handler(req, res) {
    try {
        // Qui gestiamo la richiesta proveniente dall'ESP32
        // Nel frattempo, per testare la voce parlata senza MP3, 
        // restituziamo un flusso PCM pulito o un codice di conferma strutturato.
        
        if (req.method === 'POST') {
            // L'ESP32 ha inviato la registrazione audio dei 57KB
            console.log("Audio ricevuto dall'ESP32 con successo.");
            
            // Per ora rispondiamo con un flusso binario di test pulito 
            // (oppure qui collegheremo la risposta elaborata)
            const sampleRate = 16000;
            const durationSeconds = 3;
            const numSamples = sampleRate * durationSeconds;
            const buffer = Buffer.alloc(numSamples * 2);
            
            // Generiamo un segnale vocale simulato o un tono di risposta pulito
            for (let i = 0; i < numSamples; i++) {
                const t = i / sampleRate;
                // Un tono modulato per distinguere la risposta del server
                const sample = Math.sin(2 * Math.PI * 600 * t) * 10000;
                buffer.writeInt16LE(Math.floor(sample), i * 2);
            }

            res.setHeader('Content-Type', 'application/octet-stream');
            return res.status(200).send(buffer);
        } else {
            return res.status(200).json({ status: "Kairós API Online" });
        }

    } catch (error) {
        console.error("Errore server:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
