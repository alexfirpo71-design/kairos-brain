import http, { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { spawn } from 'child_process';
import readline from 'readline';

let activeWsClient = null;
let currentVolume = 70;
const SESSION_DURATION_MS = 20000;
const sessionHistories = new Map();

// --- CONFIGURAZIONE COMANDO TASTIERA ---
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/upload') {
        let buffers = [];
        req.on('data', chunk => buffers.push(chunk));
        req.on('end', async () => {
            const imageBuffer = Buffer.concat(buffers);
            // Logica di upload esistente...
            res.writeHead(200); res.end('OK');
        });
    } else {
        res.writeHead(200); res.end('Kairos Brain Server running!');
    }
});

const wss = new WebSocketServer({ server, path: '/ws' });

// --- FUNZIONI DI SUPPORTO ---

function formatTimeForSpeech(text) {
    return text.replace(/\b([0-2]?[0-9])[:\.]([0-5][0-9])\b/g, (match, h, m) => {
        let hourText = parseInt(h) === 1 ? "l'una" : `le ${parseInt(h)}`;
        return parseInt(m) === 0 ? `${hourText} in punto` : `${hourText} e ${m}`;
    });
}

function splitTextIntoChunks(text, maxLength = 300) {
    const sentences = text.match(/[^.!?]+[.!?]+["']?|.+$/g) || [text];
    let chunks = [];
    let currentChunk = "";
    for (let sentence of sentences) {
        if ((currentChunk + sentence).length <= maxLength) currentChunk += sentence;
        else {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = sentence;
        }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
}

async function getSingleTtsPcm(textChunk, volumePercent) {
    try {
        const cleanText = encodeURIComponent(formatTimeForSpeech(textChunk).replace(/[^\w\sàèéìòùÀÈÉÌÒÙ.,?!]/g, ''));
        const response = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&q=${cleanText}&tl=it&client=tw-ob`);
        const mp3Buffer = Buffer.from(await response.arrayBuffer());
        
        return await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', ['-i', 'pipe:0', '-af', `volume=${Math.max(0.05, volumePercent / 70)}`, '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', 'pipe:1']);
            let chunks = [];
            ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
            ffmpeg.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('FFmpeg error')));
            ffmpeg.stdin.write(mp3Buffer); ffmpeg.stdin.end();
        });
    } catch (err) { console.error("[TTS Error]", err); return null; }
}

async function getGroqChatResponse(conversationHistory, userName = "Alessandro") {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'system', content: "Sei Kairós, assistente di Alessandro. Sii diretto e sintetico." }, ...conversationHistory],
            max_tokens: 500, // Aumentato per non troncare le liste
            temperature: 0.7
        })
    });
    const data = await response.json();
    return data.choices[0].message.content;
}

async function handleCameraTrigger() {
    const imageBuffer = await new Promise((resolve) => {
        http.get("http://192.168.1.154:8080/shot.jpg", (res) => {
            let chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', () => resolve(null));
    });

    const visionResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'qwen/qwen3.6-27b',
            messages: [{
                role: 'system',
                content: 'Sei Kairós. Analizza l immagine ed estrai solo le informazioni principali. Massima sintesi (massimo 2 frasi). Non spiegare il contesto.'
            }, {
                role: 'user',
                content: [{ type: 'text', text: 'Cosa vedi?' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` } }]
            }],
            max_tokens: 100, // Ridotto per sintesi
            temperature: 0.1
        })
    });
    const data = await visionResponse.json();
    return data.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// --- GESTIONE TASTIERA E WS ---
process.stdin.on('keypress', async (str, key) => {
    if (key.ctrl && key.name === 'c') process.exit();
    if (str === 'c' && activeWsClient) {
        console.log("\n[Tastiera] Comando ricevuto: scatto foto...");
        const desc = await handleCameraTrigger();
        activeWsClient.send(JSON.stringify({ action: 'speak', text: desc }));
        const chunks = splitTextIntoChunks(desc, 300);
        for (let chunk of chunks) {
            const pcm = await getSingleTtsPcm(chunk, currentVolume);
            if (pcm) activeWsClient.send(pcm, { binary: true });
        }
    }
});

wss.on('connection', (ws) => {
    activeWsClient = ws;
    ws.on('message', async (message) => { /* Logica messaggi esistente */ });
});

server.listen(process.env.PORT || 3000, () => console.log("Server Kairós attivo. Premi 'c' per scattare."));
