import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { spawn } from 'child_process';

const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Kairos Brain Server is running!\n');
});

const wss = new WebSocketServer({ server, path: '/ws' });

async function getSingleTtsPcm(textChunk) {
    try {
        const cleanText = encodeURIComponent(textChunk);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${cleanText}&tl=it&client=tw-ob`;
        const response = await fetch(ttsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) return null;
        
        const mp3Buffer = Buffer.from(await response.arrayBuffer());

        return await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', ['-i', 'pipe:0', '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', 'pipe:1']);
            let chunks = [];
            ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
            ffmpeg.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`FFmpeg code ${code}`)));
            ffmpeg.stdin.write(mp3Buffer);
            ffmpeg.stdin.end();
        });
    } catch (err) {
        return null;
    }
}

async function transcribeAudio(audioBuffer) {
    const apiKey = process.env.GROQ_API_KEY;
    const dataLength = audioBuffer.length;
    const fileLength = dataLength + 36;
    
    const header = Buffer.from([
        0x52, 0x49, 0x46, 0x46, fileLength & 0xff, (fileLength >> 8) & 0xff, (fileLength >> 16) & 0xff, (fileLength >> 24) & 0xff,
        0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20, 16, 0, 0, 0, 1, 0, 1, 0,
        16000 & 0xff, (16000 >> 8) & 0xff, (16000 >> 16) & 0xff, (16000 >> 24) & 0xff,
        32000 & 0xff, (32000 >> 8) & 0xff, (32000 >> 16) & 0xff, (32000 >> 24) & 0xff, 2, 0, 16, 0,
        0x64, 0x61, 0x74, 0x61, dataLength & 0xff, (dataLength >> 8) & 0xff, (dataLength >> 16) & 0xff, (dataLength >> 24) & 0xff
    ]);
    
    const formData = new FormData();
    formData.append('file', Buffer.concat([header, audioBuffer]), { filename: 'audio.wav', contentType: 'audio/wav' });
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'it');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, ...formData.getHeaders() },
        body: formData
    });

    const data = await response.json();
    return data.text;
}

async function getGroqChatResponse(history) {
    const apiKey = process.env.GROQ_API_KEY;
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'system', content: 'Sei Kairós, un assistente vocale italiano tecnico e sintetico.' }, ...history],
            max_tokens: 250
        })
    });
    const data = await response.json();
    return data.choices[0].message.content;
}

wss.on('connection', (ws) => {
    ws.history = [];
    let audioChunks = [];

    ws.on('message', async (message, isBinary) => {
        if (isBinary) {
            audioChunks.push(Buffer.from(message));
        } else {
            try {
                const data = JSON.parse(message.toString());
                if (data.state === 'listening') {
                    audioChunks = [];
                } else if (data.state === 'processing') {
                    const completeAudio = Buffer.concat(audioChunks);
                    audioChunks = [];

                    let reply = "Non ho ricevuto audio valido.";
                    try {
                        if (completeAudio.length > 500) {
                            const text = await transcribeAudio(completeAudio);
                            if (text && text.trim()) {
                                ws.history.push({ role: 'user', content: text });
                                reply = await getGroqChatResponse(ws.history);
                                ws.history.push({ role: 'assistant', content: reply });
                            }
                        }
                    } catch (err) {
                        reply = "Si è verificato un errore di elaborazione interno.";
                    }

                    ws.send(JSON.stringify({ action: 'speak', text: reply }));

                    const pcm = await getSingleTtsPcm(reply);
                    if (pcm) {
                        for (let i = 0; i < pcm.length; i += 1024) {
                            if (ws.readyState === ws.OPEN) ws.send(pcm.subarray(i, i + 1024));
                        }
                    }
                    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ action: 'stop' }));
                }
            } catch (e) {}
        }
    });
});

server.listen(process.env.PORT || 3000);
