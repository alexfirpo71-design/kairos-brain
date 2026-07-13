const googleTTS = require('google-tts-api');

module.exports = async (req, res) => {
   // if (req.method !== 'POST') return res.status(405).send('Solo POST');

    try {
        const text = "Ciao Alessandro, sono Kairós. Ti ascolto.";
        
        // Ottieni l'URL dell'audio da Google
        const url = googleTTS.getAudioUrl(text, {
            lang: 'it',
            slow: false,
            host: 'https://translate.google.com',
        });

        // Recupera l'audio dall'URL
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(Buffer.from(arrayBuffer));
        
    } catch (error) {
        console.error("ERRORE:", error);
        res.status(500).send('Errore: ' + error.message);
    }
};
