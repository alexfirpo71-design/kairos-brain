export default function handler(req, res) {
  if (req.method === 'POST') {
    // Qui in futuro riceveremo l'audio dal microfono
    console.log("Ricevuto stream audio dal Kairós Hub");
    res.status(200).json({ status: "Audio ricevuto, elaboro..." });
  } else {
    // Il metodo GET che abbiamo usato finora per il test
    res.status(200).json({ status: "Pronto all'ascolto" });
  }
}
