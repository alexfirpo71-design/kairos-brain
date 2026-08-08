// Sostituisci la tua vecchia getSingleTtsPcm con questa protetta
async function getSingleTtsPcm(textChunk, volumePercent) {
    try {
        const sanitizedText = textChunk
            .replace(/[^\w\sàèéìòùÀÈÉÌÒÙ.,?!]/g, '')
            .trim();

        const cleanText = encodeURIComponent(sanitizedText);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${cleanText}&tl=it&client=tw-ob`;
        
        const response = await fetch(ttsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        if (!response.ok) {
            console.error(`[Errore TTS] Status ${response.status} per: "${sanitizedText}"`);
            throw new Error(`Errore TTS HTTP: ${response.status}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const mp3Buffer = Buffer.from(arrayBuffer);

        const volumeFactor = Math.max(0.05, volumePercent / 70);

        const pcmBuffer = await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', 'pipe:0',
                '-af', `volume=${volumeFactor},equalizer=f=300:width_type=o:width=2:g=2,acompressor=threshold=-20dB:ratio=2:attack=5:release=50`,
                '-f', 's16le',
                '-acodec', 'pcm_s16le',
                '-ac', '1',
                '-ar', '16000',
                'pipe:1'
            ]);

            let chunks = [];
            ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
            ffmpeg.on('close', code => {
                if (code === 0) resolve(Buffer.concat(chunks));
                else reject(new Error(`FFmpeg exited with code ${code}`));
            });
            ffmpeg.on('error', err => reject(err));

            ffmpeg.stdin.write(mp3Buffer);
            ffmpeg.stdin.end();
        });

        const silenceSamples = 4000; 
        let paddedPcmBuffer = Buffer.concat([pcmBuffer, Buffer.alloc(silenceSamples * 2)]);

        const fadeSamplesIn = Math.min(120, paddedPcmBuffer.length / 2);
        for (let i = 0; i < fadeSamplesIn; i++) {
            const sample = paddedPcmBuffer.readInt16LE(i * 2);
            const multiplier = i / fadeSamplesIn;
            paddedPcmBuffer.writeInt16LE(Math.floor(sample * multiplier), i * 2);
        }

        const fadeSamplesOut = silenceSamples;
        const startOutIdx = (paddedPcmBuffer.length / 2) - fadeSamplesOut;
        for (let i = 0; i < fadeSamplesOut; i++) {
            const idx = (startOutIdx + i) * 2;
            const sample = paddedPcmBuffer.readInt16LE(idx);
            const multiplier = (fadeSamplesOut - i) / fadeSamplesOut;
            paddedPcmBuffer.writeInt16LE(Math.floor(sample * multiplier), idx);
        }

        return paddedPcmBuffer;
    } catch (err) {
        console.error("[Errore TTS Singolo]", err.message);
        return null;
    }
}
