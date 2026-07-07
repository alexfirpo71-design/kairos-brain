import Groq from 'groq-sdk';
import edge_tts from 'edge-tts';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      // 1. Qui riceveremo il buffer audio, per ora simuliamo il testo come facevi tu
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
      const audioStream = await communicate.stream();
      for await (const chunk of audioStream) {
        if (chunk.type === 'audio') {
          res.write(chunk.data);
        }
      }
      res.end();

    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(200).send("Kairós API in attesa...");
  }
}
