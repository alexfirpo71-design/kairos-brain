module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Solo POST');

    try {
        // Importiamo l'intero modulo
        const edgeTTS = await import("edge-tts");
        
        // Se edgeTTS è il modulo, spesso la funzione principale è in .default
        // o direttamente esportata.
        const tts = edgeTTS.default || edgeTTS;

        // In molte versioni recenti si usa una funzione diretta invece di 'new'
        // Esempio: tts.generate o una funzione di setup. 
        // Proviamo a invocare la funzione generatrice direttamente:
        const responseAudio = await tts.generate("Ciao Alessandro, sono Kairós. Ti ascolto.", {
            voice: "it-IT-ElsaNeural"
        });

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(Buffer.from(responseAudio));
    } catch (error) {
        console.error("Errore Dettagliato:", error);
        res.status(500).send('Errore nel cervello di Kairós: ' + error.message);
    }
};
