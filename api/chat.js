import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
    // Gestione CORS opzionale o controllo metodo
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

        // Configurazione della sessione di chat con la cronologia e l'istruzione di sistema
        const chat = ai.chats.create({
            model: 'gemini-2.5-flash',
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.7,
                maxOutputTokens: 4000,
            },
            history: history.map(h => ({
                role: h.role, // 'user' o 'model'
                parts: [{ text: h.content }]
            }))
        });

        // Invio del messaggio al modello
        const result = await chat.sendMessage({ message });
        const replyText = result.text || "Ricevuto.";

        console.log(`[Kairós Chat] Risposta generata: "${replyText}"`);

        return res.status(200).json({ 
            status: "success",
            reply: replyText 
        });

    } catch (error) {
        console.error("Errore nell'endpoint chat:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
