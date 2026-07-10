module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Solo POST');

    try {
        // Importiamo il modulo
        const edgeTTS = await import("edge-tts");
        
        // Stampa di debug per vedere ESATTAMENTE cosa c'è dentro
        console.log("DEBUG IMPORT:", edgeTTS);

        // La maggior parte delle versioni recenti espone una funzione diretta 
        // chiamata 'tts' o usa l'oggetto importato direttamente come generatore.
        // Proviamo la chiamata diretta:
        const responseAudio = await edgeTTS.tts("Ciao Alessandro, sono Kairós. Ti ascolto.", {
            voice: "it-IT-ElsaNeural"
        });

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(Buffer.from(responseAudio));
    } catch (error) {
        console.error("ERRORE CRITICO:", error);
        res.status(500).send('Errore: ' + error.message);
    }
};
