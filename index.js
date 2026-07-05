// api/index.js - Versione Corretta per Kairós

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb', // Impostazione per gestire il buffer audio
    },
  },
};

export default async function handler(req, res) {
  // 1. Verifica che la richiesta sia POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 2. Ricezione dei dati audio grezzi dall'ESP32
    const audioBuffer = req.body;
    console.log("Audio ricevuto, dimensione bytes:", audioBuffer.length);

    // 3. LOGICA DI ELABORAZIONE
    // In questa sezione integrerai la tua AI (es. OpenAI Whisper o altro).
    // Per ora, restituiamo un URL di esempio che inizia per "http".
    // Questo farà sì che il tuo ESP32 nel main.cpp entri nel blocco "if (payload.startsWith("http"))"
    
    const urlRisposta = "https://esempio.com/audio/risposta_vocale.mp3"; 

    // 4. Risposta all'ESP32
    // Il server deve inviare solo l'URL affinché la funzione .startsWith("http") nel main.cpp abbia successo
    res.status(200).send(urlRisposta);

  } catch (error) {
    console.error("Errore elaborazione server:", error);
    res.status(500).json({ error: 'Errore interno' });
  }
}
