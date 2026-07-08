export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      // 1. Qui ricevi i dati grezzi inviati dall'ESP32
      const audioData = req.body; 
      
      // NOTA: Per ora, per testare che il server funzioni e non dia errore 500,
      // restituiamo un buffer vuoto o un messaggio di conferma,
      // ma senza crashare il server.
      
      res.setHeader('Content-Type', 'audio/mpeg');
      // In futuro qui chiamerai Groq e Edge-TTS
      return res.status(200).send(Buffer.from([])); 
    } catch (error) {
      console.error("Errore nel server:", error);
      return res.status(500).send("Errore interno");
    }
  } else {
    res.status(405).send('Metodo non consentito');
  }
}
