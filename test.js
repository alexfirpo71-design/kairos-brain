export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // Aggiungiamo un log che apparirà nella dashboard di Vercel
  console.log("CHIAMATA RICEVUTA!"); 
  
  res.status(200).send("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3");
}
