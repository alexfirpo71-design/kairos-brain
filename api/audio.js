// Usa 'require' per evitare conflitti se il progetto non è in modalità module
const { EdgeTTS } = require("edge-tts");

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Solo POST');

    try {
        // Inizializza il TTS
        const tts = new EdgeTTS({ voice: "it-IT-ElsaNeural" });
        
        // Genera l'audio
        const responseAudio = await tts.ttsPromise("Ciao Alessandro, sono Kairós. Ti ascolto.");

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(Buffer.from(responseAudio));
    } catch (error) {
        console.error(error); // Fondamentale per vedere l'errore reale nei log
        res.status(500).send('Errore nel cervello di Kairós');
    }
}
