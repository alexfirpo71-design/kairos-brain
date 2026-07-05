// api/index.js - Versione ottimizzata per Kairós
export const config = {
  api: {
    bodyParser: false, // Disabilita il parser per gestire flussi binari grezzi dall'ESP32
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Leggi il flusso binario grezzo (buffer audio)
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);
    
    console.log("Audio ricevuto, dimensione bytes:", audioBuffer.length);

    // --- LOGICA DI RISPOSTA ---
    // Questo è l'URL che il tuo main.cpp deve ricevere per avviare l'audio.
    // Una volta testato, qui chiamerai la tua logica AI per generare il link corretto.
    const urlAudioRisposta = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"; 

    // Rispondi inviando SOLO l'URL come stringa pura
    res.status(200).send(urlAudioRisposta);

  } catch (error) {
    console.error("Errore elaborazione server:", error);
    res.status(500).json({ error: 'Errore interno' });
  }
}
