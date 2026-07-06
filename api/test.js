import { Groq } from 'groq-sdk';

// Inizializza Groq con la chiave salvata nelle variabili d'ambiente di Vercel
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      // Legge il testo inviato nel corpo della richiesta
      const { text } = req.body;

      if (!text) {
        return res.status(400).json({ error: "Testo mancante" });
      }

      // Interroga Groq usando il modello Llama 3 (estremamente veloce)
      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: "user", content: text }],
        model: "llama3-8b-8192",
      });

      const responseText = chatCompletion.choices[0].message.content;

      // Per ora restituiamo il testo. 
      // Nel prossimo step integreremo la generazione audio.
      res.status(200).json({ answer: responseText });
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(200).send("Kairós API pronta per ricevere domande.");
  }
}
