module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Solo POST');

    try {
        // Importazione corretta e flessibile
        const edgeTTS = await import("edge-tts");
        
        // Molte versioni di edge-tts usano 'EdgeTTS' come export principale 
        // o hanno una funzione di creazione. Proviamo l'accesso diretto:
        const EdgeTTS = edgeTTS.EdgeTTS || edgeTTS.default || edgeTTS;
        
        const tts = new EdgeTTS({ voice: "it-IT-ElsaNeural" });
        const responseAudio = await tts.ttsPromise("Ciao Alessandro, sono Kairós. Ti ascolto.");

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(Buffer.from(responseAudio));
    } catch (error) {
        console.error("Errore Dettagliato:", error);
        res.status(500).send('Errore nel cervello di Kairós: ' + error.message);
    }
};
