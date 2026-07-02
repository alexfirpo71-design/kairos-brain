export default async function handler(req, res) {
  // Impostiamo gli header per accettare qualsiasi origine e metodo
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    console.log("Ricevuto stream audio dal Kairós Hub");
    // Risposta 200 per confermare che il POST è stato accettato
    return res.status(200).json({ status: "Audio ricevuto", received: true });
  }

  // Risposta di default per GET
  return res.status(200).json({ status: "Pronto all'ascolto" });
}
