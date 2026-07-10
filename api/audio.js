const { EdgeTTS } = require("edge-tts");

// Usiamo module.exports invece di export default
module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Solo POST');

    try {
        const tts = new EdgeTTS({ voice: "it-IT-ElsaNeural" });
        const responseAudio = await tts.ttsPromise("Ciao Alessandro, sono Kairós. Ti ascolto.");

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(Buffer.from(responseAudio));
    } catch (error) {
        console.error("Errore TTS:", error);
        res.status(500).send('Errore nel cervello di Kairós');
    }
};
