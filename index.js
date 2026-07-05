// Codice API completo per Vercel
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb', // Necessario per gestire il buffer audio inviato dall'ESP32
    },
  },
};

export default async function handler(req, res) {
  // Accetta solo richieste POST dal tuo ESP32
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Ricezione del flusso audio (application/octet-stream)
    const audioBuffer = req.body;
    console.log("Audio ricevuto da ESP32, dimensione:", audioBuffer ? audioBuffer.length : 0);

    // --- LOGICA DI RISPOSTA ---
    // Invece di inviare "OK", inviamo l'URL che il main.cpp si aspetta.
    // Assicurati che l'URL che inserisci qui sia un link pubblico e funzionante.
    const urlAudioRisposta = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"; 

    // Risposta che soddisfa la condizione payload.startsWith("http") nel tuo main.cpp
    res.status(200).send(urlAudioRisposta);

  } catch (error) {
    console.error("Errore elaborazione server:", error);
    res.status(500).json({ error: 'Errore interno' });
  }
}
