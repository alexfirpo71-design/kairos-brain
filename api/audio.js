// Generiamo l'audio TTS della risposta di Gemini
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(replyText)}&tl=it&client=tw-ob`;
    
    const ttsResponse = await fetch(ttsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (!ttsResponse.ok) {
        throw new Error(`Errore TTS: ${ttsResponse.statusText}`);
    }

    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(audioBuffer);
