import fetch from 'node-fetch';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Solo POST');
    }

    try {
        // 1. Generiamo la risposta intelligente con Groq (con la nostra identità)
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
                        content: 'Sei Kairós, l"alter ego di Alessandro. Rispondi con estrema sintesi (massimo 20 parole), in italiano, con la sua stessa schiettezza e competenza tecnica.' 
                    },
                    { role: 'user', content: 'Dammi riscontro audio.' }
                ],
                max_tokens: 60
            })
        });

        const data = await groqResponse.json();
        const testoRisposta = data.choices[0].message.content;

        // Stampiamo nei log di Vercel il testo generato per controllo
        console.log("Kairós (Testo):", testoRisposta);

        // 2. Per adesso, per far parlare la cassa con i dati binari corretti, 
        // facciamo restituire il flusso audio generato o un buffer PCM di test valido.
        // (Qui collegheremo il TTS pulito per trasformare 'testoRisposta' in stream PCM)
        
        return res.status(200).setHeader('Content-Type', 'application/octet-stream').send(testoRisposta);

    } catch (errore) {
        console.error("ERRORE:", errore);
        return res.status(500).json({ errore: errore.message });
    }
}
