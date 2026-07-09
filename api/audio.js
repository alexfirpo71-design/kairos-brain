import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const response = await fetch('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3');
      const buffer = await response.buffer();
      
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.status(200).send(buffer);
    } catch (error) {
      return res.status(500).send("Errore nel recupero audio");
    }
  } else {
    res.status(405).send('Metodo non consentito');
  }
}
