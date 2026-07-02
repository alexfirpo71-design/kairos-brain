export default function handler(req, res) {
  // Ora leggiamo i dati dall'URL (query)
  const trigger = req.query.trigger;
  
  console.log("Dati ricevuti:", trigger);
  
  res.status(200).json({ status: "Ricevuto", valore: trigger });
}
