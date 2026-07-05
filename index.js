// Codice API completo e ottimizzato per Vercel - Progetto Kairós

export const config = {
  api: {
    bodyParser: false, // Disabilitato per ricevere il flusso binario (octet-stream) grezzo
  },
};

export default async function handler(req, res) {
  // Accetta solo richieste POST dal tuo ESP32
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Lettura manuale del flusso binario grezzo
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);
    
    console.log("Audio ricevuto da ESP32, dimensione bytes:", audioBuffer.length);

    // --- LOGICA DI RISPOSTA ---
    // Questo URL deve iniziare per "http" affinché il main.cpp esegua audio.connecttohost()
    const urlAudioRisposta = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"; 

    // Risposta diretta con l'URL per il firmware
    res.status(200).send(urlAudioRisposta);

  } catch (error) {
    console.error("Errore elaborazione server:", error);
    res.status(500).json({ error: 'Errore interno' });
  }
}
