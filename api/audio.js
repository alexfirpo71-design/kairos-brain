const googleTTS = require('google-tts-api');

module.exports = async (req, res) => {
    try {
        const text = "Ciao Alessandro, sono Kairós. Ti ascolto.";

        // Ottieni l'URL dell'audio da Google
        const url = googleTTS.getAudioUrl(text, {
            lang: 'it',
            slow: false,
            host: 'https://translate.google.com',
        });

        // Scarica l'MP3 da Google
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // NOTA: Poiché google-tts restituisce un MP3, l'ESP32 ha bisogno 
        // di un formato raw. Per adesso, inviamo il buffer pulito 
        // impostando il corretto streaming audio.
        res.setHeader('Content-Type', 'audio/basic');
        res.send(buffer);

    } catch (error) {
        console.error("ERRORE:", error);
        res.status(500).send('Errore: ' + error.message);
    }
};
