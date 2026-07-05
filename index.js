export const config = {
  api: {
    bodyParser: false, // Necessario per leggere il flusso audio binario
  },
};

export default async function handler(req, res) {
  // Verifica che il metodo sia POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Legge il flusso binario in arrivo
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    
    // Ora il server ha ricevuto i dati. 
    // Rispondiamo inviando SOLO l'URL pulito, senza altro testo.
    res.status(200).send("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3");
    
  } catch (error) {
    // Gestione errori
    res.status(500).json({ error: 'Errore interno' });
  }
}
