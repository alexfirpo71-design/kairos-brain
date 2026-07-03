export default async function handler(req, res) {
  if (req.method === 'POST') {
    // Il server riceve il flusso audio dall'ESP32
    // Per ora inviamo una risposta di stato 200
    // In seguito qui collegheremo l'IA (OpenAI/Whisper)
    res.status(200).send("OK"); 
  } else {
    // Risposta standard per testare se il server è attivo
    res.status(200).send("Kairós API Online");
  }
}
