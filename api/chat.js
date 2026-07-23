import fetch from 'node-fetch';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Solo POST');
    }

    try {
        // 1. Chiamata a Groq per l'intelligenza
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { 
                        role: 'system', 
                        content: 'Sei Kairós, l"alter ego di Alessandro. Rispondi in modo estremamente sintetico ed emetti segnali vocali.' 
                    },
                    { role: 'user', content: 'Conferma vocale attiva.' }
                ],
                max_tokens: 30
            })
        });

        const data = await groqResponse.json();
        const testo = data.choices[0].message.content;
        console.log("Kairós Testo:", testo);

        // 2. Generiamo un buffer PCM audio pulito (16kHz, 16-bit mono) direttamente dai byte 
        // per far muovere la membrana della cassa I2S senza corrompere il flusso.
        const sampleRate = 16000;
        const durationSeconds = 1.5; // Durata dell'audio in secondi
        const numSamples = sampleRate * durationSeconds;
        const pcmBuffer = Buffer.alloc(numSamples * 2); // 2 bytes per sample (16-bit)

        for (let i = 0; i < numSamples; i++) {
            // Generiamo un'onda sonora modulata intelligibilmente (tono vocale simulato)
            const t = i / sampleRate;
            const freq = 440 + Math.sin(t * 10) * 150; 
            const sample = Math.sin(2 * Math.PI * freq * t) * 10000 * Math.exp(-t);
            pcmBuffer.writeInt16LE(Math.floor(sample), i * 2);
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        return res.status(200).send(pcmBuffer);

    } chech (errore) {
        console.error("ERRORE:", errore);
        return res.status(500).json({ errore: errore.message });
    }
}
