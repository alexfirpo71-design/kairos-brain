export default async function handler(req, res) {
  // --- NUOVA LOGICA: Se ricevi un test, Kairós risponde ---
  if (req.body.test === true) {
     return res.status(200).json({ 
       reply: "Ehilà! Sono Kairós. Il sistema è online e sto ascoltando." 
     });
  }

  // --- LOGICA ESISTENTE: Gestione audio per l'ESP32 ---
  res.status(200).json({
    message: "Ricevuto",
    method: req.method,
    length: req.headers['content-length']
  });
}
