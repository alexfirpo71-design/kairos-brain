// Esempio logica per index.js
export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { testoUtente } = req.body; // Il testo trascritto dal microfono

    try {
      // 1. Chiamata a Groq per l'intelligenza
      const rispostaGroq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer TUA_API_KEY_GROQ`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: "llama3-8b-8192",
          messages: [{ role: "user", content: testoUtente }]
        })
      });
      const data = await rispostaGroq.json();
      const rispostaAI = data.choices[0].message.content;

      // 2. Invio a tts.py (che hai già pronto)
      // Qui aggiungeremo la logica per chiamare il tuo script Python
      res.status(200).json({ risposta: rispostaAI });
      
    } catch (error) {
      res.status(500).send("Errore durante la generazione della risposta");
    }
  }
}
