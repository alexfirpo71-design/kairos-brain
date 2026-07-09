export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      // Esempio: recupera audio da una fonte esterna
      const response = await fetch('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3');
      const audioBuffer = await response.arrayBuffer();
      
      res.setHeader('Content-Type', 'audio/mpeg');
      res.status(200).send(Buffer.from(audioBuffer));
    } catch (error) {
      res.status(500).send('Errore nel recupero audio');
    }
  } else {
    res.status(405).send('Metodo non consentito');
  }
}
