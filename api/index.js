import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: "Bot attivo e in attesa di richieste" });
  }

  try {
    // Qui andrà la tua logica di chiamata a Groq/TTS
    res.status(200).json({ message: "Funzionante" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
