export default async function handler(req, res) {
  if (req.method === 'POST') {
    res.setHeader('Content-Type', 'audio/mpeg');
    // Puntiamo a un file audio di test online (formato mp3)
    // Questo farà ripartire la riproduzione come faceva l'altro ieri
    return res.redirect('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3');
  } else {
    return res.status(405).send('Metodo non consentito');
  }
}
