import { GoogleGenAI } from '@google/genai';

export const config = {
  api: {
    bodyParser: false,
  },
};

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length === 0) {
      return res.status(400).json({ error: 'Audio buffer is empty' });
    }

    // Invio dell'audio a Gemini per la generazione della risposta testuale
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: audioBuffer.toString('base64'),
                mimeType: 'audio/pcm',
              },
            },
            {
              text: 'Ascolta questo messaggio audio e rispondi in modo sintetico, diretto e colloquiale, pronto per essere letto da una voce sintetica.',
            },
          ],
        },
      ],
    });

    const replyText = response.text;

    // Per adesso, per verificare che la cassa suoni, restituiamo un flusso PCM di test (un beep o tono) 
    // oppure puoi collegare qui il generatore TTS di Google Cloud per la voce parlata.
    // Generiamo un buffer PCM silenzioso/tono di prova per chiudere il cerchio sul flusso dati:
    const sampleRate = 16000;
    const durationSec = 2; // 2 secondi di audio
    const numSamples = sampleRate * durationSec;
    const pcmBuffer = Buffer.alloc(numSamples * 2);

    for (let i = 0; i < numSamples; i++) {
      // Onda sinusoidale a 440Hz (La4)
      const sample = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 10000;
      pcmBuffer.writeInt16LE(Math.floor(sample), i * 2);
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', pcmBuffer.length);
    return res.status(200).send(pcmBuffer);

  } catch (error) {
    console.error('Errore server:', error);
    return res.status(500).json({ error: error.message });
  }
}
