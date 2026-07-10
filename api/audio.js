module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Solo POST');

    try {
        // Import dinamico: aggira il problema del modulo ESM
        const { EdgeTTS } = await import("edge-tts");
        
        const tts = new EdgeTTS({ voice: "it-IT-ElsaNeural" });
        const responseAudio = await tts.ttsPromise("Ciao Alessandro, sono Kairós. Ti ascolto.");

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(Buffer.from(responseAudio));
    } catch (error) {
        console.error("Errore Dettagliato:", error);
        res.status(500).send('Errore nel cervello di Kairós: ' + error.message);
    }
};
