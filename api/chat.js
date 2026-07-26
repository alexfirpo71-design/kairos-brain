import fetch from 'node-fetch';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Solo POST');
    }

    try {
        // 1. Otteniamo la risposta intelligente da Groq (Gratuito e velocissimo)
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
                        content: 'Sei Kairós, l\'alter ego di Alessandro. Rispondi in modo conciso, amichevole e diretto.'
                    },
                    { role: 'user', content: 'Ricezione audio effettuata. Rispondi brevemente.' }
                ],
                max_tokens: 40
            })
        });

        const data = await groqResponse.json();
        const testoRisposta = data.choices[0].message.content;
        console.log("Kairós Testo:", testoRisposta);

        // 2. Utilizziamo un TTS completamente gratuito e senza chiavi (Google Translate TTS Engine)
        // Questo converte il testo in un link audio MP3 scaricabile al volo senza token.
        const encodedText = encodeURIComponent(testoRisposta);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=it&client=tw-ob`;

        const ttsResponse = await fetch(ttsUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        if (!ttsResponse.ok) {
            throw new Error(`Errore dal servizio TTS gratuito: ${ttsResponse.statusText}`);
        }

        const audioBuffer = await ttsResponse.arrayBuffer();

        // 3. Inviamo lo streaming audio all'ESP32
        res.setHeader('Content-Type', 'application/octet-stream');
        return res.status(200).send(Buffer.from(audioBuffer));

    } catch (errore) {
        console.error("ERRORE:", errore);
        return res.status(500).json({ errore: errore.message });
    }
}
