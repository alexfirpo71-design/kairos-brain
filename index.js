export default function handler(req, res) {
  // Questa riga dice al server: "Accetta anche le chiamate POST"
  if (req.method === 'POST') {
    return res.status(200).json({ message: "Dati ricevuti!" });
  }
  
  // Risposta standard per altri tipi di chiamate
  res.status(200).json({ status: "Kairós è online!" });
}
