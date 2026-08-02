async function getTtsPcmAudio(text) {
    try {
        const cleanText = encodeURIComponent(text.substring(0, 150));
        // Usiamo un endpoint alternativo che restituisce un flusso audio chiaro
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${cleanText}&tl=it&client=tw-ob`;
        
        const response = await fetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        if (!response.ok) throw new Error(`Errore TTS HTTP: ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        let audioBuffer = Buffer.from(arrayBuffer);

        // Se Google ci restituisce l'MP3, lo mandiamo direttamente a blocchi 
        // ma assicurandoci che il client/ESP32 lo riceva correttamente.
        return audioBuffer;
    } catch (err) {
        console.error("[Errore TTS]", err);
        return null;
    }
}
