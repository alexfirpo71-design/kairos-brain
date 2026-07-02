export default function handler(req, res) {
  // Risposta standard di successo per il protocollo HTTP
  res.status(200).json({ status: "Ricevuto", received: true });
}
