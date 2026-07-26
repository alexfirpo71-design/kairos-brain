import { Readable } from 'stream';
import prism from 'prism-media'; // Gestisce la decodifica audio su Node

export default async function handler(req, res) {
    try {
        const text = "Il sistema Kairos e online e operativo.";
        const encodedText = encodeURIComponent(text);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=it&client=tw-ob`;

        const ttsResponse = await fetch(ttsUrl);
        if (!ttsResponse.ok) {
            throw new Error("Errore nel recupero dell'audio");
        }

        const arrayBuffer = await ttsResponse.arrayBuffer();
        const inputBuffer = Buffer.from(arrayBuffer);

        // Convertiamo l'MP3 di Google in PCM grezzo (16kHz, Mono, 16-bit) tramite prism-media o ffmpeg stream
        const transcoder = new prism.FFmpeg({
            args: [
                '-i', 'pipe:0',
                '-f', 's16le',
                '-acodec', 'pcm_s16le',
                '-ar', '16000',
                '-ac', '1'
            ]
        });

        res.setHeader('Content-Type', 'application/octet-stream');
        
        const stream = Readable.from(inputBuffer);
        stream.pipe(transcoder).pipe(res);

    } catch (error) {
        console.error("Errore:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
