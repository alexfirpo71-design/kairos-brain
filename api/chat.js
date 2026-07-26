import { Buffer } from 'buffer';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // 1. Legge il flusso PCM grezzo inviato dall'ESP32
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        const audioBuffer = Buffer.concat(chunks);

        if (audioBuffer.length === 0) {
            return res.status(400).json({ error: 'Audio vuoto ricevuto' });
        }

        // --- Qui inserisci la tua logica di elaborazione (es. chiamata a Groq / OpenAI) ---
        // Ottieni il testo della risposta testuale del modello IA.
        // Esempio: const aiResponseText = "Ciao Alessandro, Kairós è operativo.";
        const aiResponseText = "Kairós online e operativo."; 

        // 2. Chiamata al TTS di Google Translate (o altro motore) per generare l'audio parlato
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(aiResponseText)}&tl=it&client=tw-ob`;
        
        const ttsResponse = await fetch(ttsUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        if (!ttsResponse.ok) {
            throw new Error(`Errore dal servizio TTS: ${ttsResponse.statusText}`);
        }

        const mp3Buffer = Buffer.from(await ttsResponse.arrayBuffer());

        // 3. Invio dell'audio pulito in formato raw/stream direttamente all'ESP32
        // Impostiamo gli header corretti per un flusso binario continuo
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.status(200).send(mp3Buffer);

    } catch (error) {
        console.error('Errore nel server Kairós:', error);
        res.status(500).json({ error: error.message });
    }
}
