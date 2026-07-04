export default async function handler(req, res) {
  // Log per debug su Vercel
  console.log("Metodo ricevuto:", req.method);

  if (req.method === 'POST') {
    try {
      // 1. Qui ricevi l'audio dall'ESP32
      // Per ora, simuliamo la ricezione per validare il collegamento
      const audioData = req.body; 
      console.log("Dati audio ricevuti, dimensione:", audioData ? audioData.length : "vuoto");

      // 2. Chiamata a Groq (con la tua API Key salvata nelle variabili ambientali)
      const rispostaGroq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.CHIAVE_API_GROQ}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: "llama3-8b-8192",
          messages: [{ role: "user", content: "Rispondi brevemente e in modo amichevole." }]
        })
      });

      const data = await rispostaGroq.json();
      const rispostaAI = data.choices[0].message.content;
      console.log("Risposta AI generata:", rispostaAI);

      // 3. Risposta all'ESP32
      // ATTENZIONE: Qui devi restituire l'URL di un file audio (es. un server TTS)
      // Per il test, inviamo un URL mp3 di prova se la comunicazione funziona
      const urlAudioTest = "https://files.catbox.moe/o3d9p3.mp3"; 
      
      return res.status(200).send(urlAudioTest);

    } catch (error) {
      console.error("Errore:", error);
      return res.status(500).send("Errore server");
    }
  } else {
    res.status(405).send("Metodo non permesso");
  }
}
