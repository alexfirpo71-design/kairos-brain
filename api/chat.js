import fetch from 'node-fetch';

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(200).json({ status: "Kairós Chat API Online (Groq)" });
    }

    try {
        const { message, history = [], memories = "" } = req.body;

        if (!message || message.trim() === "") {
            return res.status(400).json({ error: 'Il messaggio non può essere vuoto' });
        }

        console.log(`[Kairós Chat] Messaggio ricevuto: "${message}"`);

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            console.error('[❌ Config] GROQ_API_KEY non configurato!');
            return res.status(500).json({ error: 'API key non configurata.' });
        }

        const userName = "Alessandro";
        
        // Prompt di sistema sincronizzato con server.js
        const systemPrompt = `Kairós, l'assistente IA avanzato di ${userName}. 
Parli sempre in italiano in modo diretto, deciso ma senza eccessive lungaggini e solo quando viene richiesto.

ISTRUZIONE CRITICA SULLA MEMORIA LOCALE:
Quando l'utente ti chiede esplicitamente di memorizzare, ricordare o salvare un fatto, un'informazione o una preferenza:
- DEVI iniziare la risposta ESATTAMENTE con le lettere MAIUSCOLE "MEMORIZZA: " seguite dal dato da ricordare.
- Subito dopo il comando, scrivi la frase di conferma che pronuncerai all'utente.
Esempio esatto di risposta: "MEMORIZZA: L'età di Tiziana è 55 anni. Fatto, ho memorizzato l'età di Tiziana."
Se non ti viene chiesto di memorizzare nulla, rispondi normalmente SENZA usare quel prefisso.

RICORDI SALVATI SUL DISPOSITIVO DELL'UTENTE (da usare attivamente se interrogato):
${memories ? memories : "Nessun ricordo aggiuntivo salvato al momento."}

CONTESTO PRIVATO (da usare ESCLUSIVAMENTE se l'utente ti fa domande dirette in merito):
- L'utente ha 55 anni e si chiama Alessandro, è un tecnico elettronico a Genova.
- Famiglia e affetti: la figlia Margot, la fidanzata Tiziana, papà Lino, mamma Elviana mancata il 23 dicembre 2024, il gatto Lulù, il coniglio Isalide, il cane Miele, e la gatta Prugna mancata a maggio 2026.
- Passioni tecniche: riparazione console vintage, simulazione di volo, pilota di droni.`;

        // Formattazione della cronologia per l'API di Groq
        const formattedHistory = history.map(h => ({
            role: h.role, // 'user' o 'assistant'
            content: h.content || h.text
        }));

        const messages = [
            { role: 'system', content: systemPrompt },
            ...formattedHistory,
            { role: 'user', content: message }
        ];

        // Chiamata alle API di Groq
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${apiKey}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-20b',
                messages: messages,
                max_tokens: 4000,
                temperature: 0.7
            }),
            timeout: 30000
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Errore Groq API: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        const replyText = data.choices[0]?.message?.content || "Errore risposta.";

        console.log(`[Kairós Chat] Risposta generata: "${replyText}"`);

        // Gestione del comando MEMORIZZA se attivato
        let isMemoryAction = false;
        let memoryData = null;
        let clientReply = replyText;

        if (replyText.startsWith("MEMORIZZA:")) {
            isMemoryAction = true;
            memoryData = replyText.replace("MEMORIZZA:", "").trim();
            clientReply = "Fatto, memorizzato.";
        }

        return res.status(200).json({ 
            status: "success",
            reply: clientReply,
            rawReply: replyText,
            isMemory: isMemoryAction,
            memoryData: memoryData
        });

    } catch (error) {
        console.error("Errore nell'endpoint chat:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
