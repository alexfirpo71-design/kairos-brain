import fetch from 'node-fetch';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Solo POST');
    }

    try {
        // 1. Otteniamo la risposta intelligente da Groq
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
                        content: 'Sei Kairós, l"alter ego di Alessandro. Rispondi con estrema sintesi, in italiano.' 
                    },
                    { role: 'user', content: 'Conferma ricezione audio.' }
                ],
                max_tokens: 30
            })
        });

        const data = await groqResponse.json();
        const testoRisposta = data.choices[0].message.content;
        console.log("Kairós Testo:", testoRisposta);

        // 2. Utilizziamo le API TTS di OpenAI (o un motore compatibile) per convertire il testo in voce reale (MP3/PCM)
        const ttsResponse = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'tts-1',
                input: testoRisposta,
                voice: 'onyx', // Voce profonda e seria, ideale per Kairós
                response_format: 'pcm' // Formato PCM grezzo pronto per l'I2S dell'ESP32
            })
        });

        if (!ttsResponse.ok) {
            throw new Error(`Errore dal servizio TTS: ${ttsResponse.statusText}`);
        }

        const audioBuffer = await ttsResponse.arrayBuffer();

        res.setHeader('Content-Type', 'application/octet-stream');
        return res.status(200).send(Buffer.from(audioBuffer));

    } catch (errore) {
        console.error("ERRORE:", errore);
        return res.status(500).json({ errore: errore.message });
    }
}
