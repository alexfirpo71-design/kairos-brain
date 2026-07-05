export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // Risposta fissa per testare se il server risponde correttamente
    res.status(200).send("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3");
  } else {
    res.status(405).send("Method not allowed");
  }
}
