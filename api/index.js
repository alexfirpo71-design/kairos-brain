import Groq from 'groq-sdk';
import * as edge_tts from 'edge-tts'; // Importazione corretta per ES Modules

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      // 1. Simulazione testo
      const userText = "Ciao, come stai?";

      // 2. Chiamata a Groq
      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: "user", content: userText }],
        model: "llama3-8b-8192",
      });

      const responseText = chatCompletion.choices[0].message.content;

      // 3. Sintesi vocale (TTS)
      res.setHeader('Content-Type', 'audio/mpeg');
      
      const communicate = new edge_tts.Communicate(responseText, "it-IT-ElsaNeural");
      
      // Trasmissione del flusso audio
      await communicate.stream(async (chunk) => {
        if (chunk.type === 'audio') {
          res.write(chunk.data);
        }
      });
      
      res.end();

    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  } else {
    res.status(200).send("Kairós API in attesa...");
  }
}
