import fetch from 'node-fetch';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Solo POST');
    }

    try {
        // Qui gestiamo l'arrivo dei dati dall'ESP32
        const prompt = "Ciao Kairós, dammi una risposta intelligente e memorizzabile.";

        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 150
            })
        });

        const data = await groqResponse.json();
        
        if (!data.choices || !data.choices[0]) {
            throw new Error('Risposta non valida da Groq');
        }

        const rispostaIA = data.choices[0].message.content;

        // Restituiamo il JSON con la risposta testuale pulita
        return res.status(200).json({ risposta: rispostaIA });

    } catch (errore) {
        console.error("ERRORE:", errore);
        return res.status(500).json({ errore: errore.message });
    }
}
