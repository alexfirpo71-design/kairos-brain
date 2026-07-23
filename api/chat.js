import fetch from 'node-fetch';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Solo POST');
    }

    try {
        // Chiamata a Groq con la nostra identità e intelligenza
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
                        content: 'Sei Kairós, l"alter ego di Alessandro. Rispondi con estrema sintesi, in italiano, con la sua stessa schiettezza e competenza tecnica.' 
                    },
                    { role: 'user', content: 'Ascolta il mio segnale e rispondi.' }
                ],
                max_tokens: 60
            })
        });

        const data = await groqResponse.json();
        const testoRisposta = data.choices[0].message.content;

        console.log("Kairós (Testo):", testoRisposta);

        return res.status(200).json({ risposta: testoRisposta });

    } catch (errore) {
        console.error("ERRORE:", errore);
        return res.status(500).json({ errore: errore.message });
    }
}
