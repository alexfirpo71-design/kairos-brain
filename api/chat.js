import fetch from 'node-fetch';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Solo POST');
    }

    try {
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
                        content: 'Sei Kairós, l\'alter ego di Alessandro. Rispondi in modo conciso e diretto.'
                    },
                    { role: 'user', content: 'Ricezione audio effettuata. Conferma.' }
                ],
                max_tokens: 30
            })
        });

        const data = await groqResponse.json();
        const testoRisposta = data.choices[0].message.content;
        console.log("Kairós Testo:", testoRisposta);

        // Usiamo un servizio di TTS alternativo che supporta formati lineari o usiamo un TTS compatibile
        // In alternativa, usiamo un generatore TTS via gTTS pubblico o un convertitore
        const encodedText = encodeURIComponent(testoRisposta);
        
        // Sfruttiamo un endpoint alternativo o passiamo a un TTS pulito
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=it&client=tw-ob`;
        const ttsResponse = await fetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (!ttsResponse.ok) {
            throw new Error(`Errore TTS: ${ttsResponse.statusText}`);
        }

        const audioBuffer = await ttsResponse.arrayBuffer();

        // Nota: Poiché Google restituisce MP3, per farlo digerire all'ESP32 senza decoder MP3 pesante,
        // mandiamo un comando o usiamo un layer compatibile. 
        // Tuttavia, se vuoi la strada più rapida sull'ESP32 senza librerie di decodifica, 
        // possiamo far pronunciare il testo tramite un piccolo script o convertire i byte.
        
        res.setHeader('Content-Type', 'application/octet-stream');
        return res.status(200).send(Buffer.from(audioBuffer));

    } chech (errore) { // (correggendo in catch)
