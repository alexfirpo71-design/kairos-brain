module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Solo POST');

    try {
        const edgeTTS = await import("edge-tts");
        
        // Diagnostica: stampiamo tutto quello che la libreria offre
        console.log("Metodi disponibili nella libreria:", Object.getOwnPropertyNames(edgeTTS));
        console.log("Oggetto esportato:", edgeTTS);

        // Tentativo di inizializzazione basato sulla documentazione standard
        // Molte versioni richiedono: new edgeTTS.EdgeTTS()
        const tts = new edgeTTS.EdgeTTS({ voice: "it-IT-ElsaNeural" });
        
        // E poi il metodo solitamente si chiama 'ttsPromise' o 'save'
        const responseAudio = await tts.ttsPromise("Ciao Alessandro, sono Kairós. Ti ascolto.");

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(Buffer.from(responseAudio));
    } catch (error) {
        console.error("Errore Dettagliato:", error);
        res.status(500).send('Errore critico: ' + error.message);
    }
};
