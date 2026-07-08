export default async function handler(req, res) {
  if (req.method === 'POST') {
    // Risposta di test per verificare che l'ESP32 riceva dati
    res.setHeader('Content-Type', 'audio/mpeg');
    // Inviamo un piccolo buffer vuoto ma valido per il formato audio
    return res.status(200).send(Buffer.alloc(0));
  } else {
    return res.status(405).send('Metodo non consentito');
  }
}
