import { Buffer } from 'buffer';
import fetch from 'node-fetch';

export const config = {
    api: {
        bodyParser: true,
    },
};

// Funzione per la chat testuale con Groq (Llama)
async function getGroqChatResponse(messages) {
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile', // Sostituisci con 'llama-3.1-8b-instant' se vuoi più velocità
            messages: messages,
            max_tokens: 4000,
            temperature: 0.7
        })
    });

    if (!groqResponse.ok) {
        const errData = await groqResponse.text();
        throw new Error(`Errore API Groq: ${groqResponse.status} - ${errData}`);
    }

    const data = await groqResponse.json();
    return data.choices[0]?.message?.content || '';
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).json({ status: "Kairós Chat API Online" });
    }

    try {
        const { message, history = [] } = req.body;

        if (!message || message.trim() === "") {
            return res.status(400).json({ error: 'Il messaggio non può essere vuoto' });
        }

        console.log(`[Kairós Chat] Messaggio ricevuto: "${message}"`);

        // Prompt di sistema coerente con l'identità di Kairós e il profilo utente
        const systemInstruction = `Sei Kairós, l'assistente IA avanzato di Alessandro. 
Parli sempre in italiano in modo diretto, deciso ma senza eccessive lungaggini. 
Ricordi i messaggi precedenti e il profilo dell'utente (perito elettronico, appassionato di retrogaming, flight simulation e cucina tecnica).`;

        // Mappa la cronologia nel formato standard OpenAI/Groq (system, user, assistant)
        const formattedMessages = [
            { role: 'system', content: systemInstruction },
            ...history.map(h => ({
                role: h.role === 'model' ? 'assistant' : h.role, // Adatta 'model' in 'assistant' per Groq
                content: h.content
            })),
            { role: 'user', content: message }
        ];

        // Invio dei messaggi a Llama tramite Groq
        const replyText = await getGroqChatResponse(formattedMessages);
        const finalReply = replyText || "Ricevuto.";

        console.log(`[Kairós Chat] Risposta generata: "${finalReply}"`);

        return res.status(200).json({ 
            status: "success",
            reply: finalReply 
        });

    } catch (error) {
        console.error("Errore nell'endpoint chat:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
