import http, { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import { spawn } from 'child_process';
import readline from 'readline';

let activeWsClient = null;
let currentVolume = 70;

// Configurazione Terminale
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

const server = createServer((req, res) => {
    res.writeHead(200); res.end('Kairos Server Online');
});

const wss = new WebSocketServer({ server, path: '/ws' });

// --- GESTIONE TESTO ---
function splitTextIntoChunks(text, maxLength = 500) {
    // Aumentato maxLength a 500 per evitare tagli frequenti
    return text.match(new RegExp(`.{1,${maxLength}}(\\s|$)|.{1,${maxLength}}`, 'g')) || [text];
}

async function getSingleTtsPcm(text, volumePercent) {
    try {
        const cleanText = encodeURIComponent(text.replace(/[^\w\sàèéìòù.,?!]/g, ''));
        const response = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&q=${cleanText}&tl=it&client=tw-ob`);
        const mp3Buffer = Buffer.from(await response.arrayBuffer());
        
        return await new Promise((resolve) => {
            const ffmpeg = spawn('ffmpeg', ['-i', 'pipe:0', '-af', `volume=${volumePercent / 50}`, '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', 'pipe:1']);
            let chunks = [];
            ffmpeg.stdout.on('data', c => chunks.push(c));
            ffmpeg.on('close', () => resolve(Buffer.concat(chunks)));
            ffmpeg.stdin.write(mp3Buffer); ffmpeg.stdin.end();
        });
    } catch (e) { console.error(e); return null; }
}

// --- GESTIONE CAMERA ---
async function handleCameraTrigger() {
    console.log("[Camera] Richiesta scatto...");
    return await new Promise((resolve) => {
        http.get("http://192.168.1.154:8080/shot.jpg", (res) => {
            let chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', async () => {
                const buffer = Buffer.concat(chunks);
                console.log(`[Camera] Ricevuti: ${buffer.length} bytes`);
                
                // Nessun filtro arbitrario sulla dimensione, lasciamo che arrivi quello che arriva
                const visionResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'qwen/qwen3.6-27b',
                        messages: [
                            { role: 'system', content: 'Sei Kairós. Rispondi in modo esaustivo ma chiaro. Descrivi ciò che vedi.' },
                            { role: 'user', content: [{ type: 'text', text: 'Analizza questa immagine.' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buffer.toString('base64')}` } }] }
                        ],
                        max_tokens: 300, 
                        temperature: 0.5
                    })
                });
                const data = await visionResponse.json();
                resolve(data.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim());
            });
        }).on('error', () => resolve("Errore di connessione alla camera."));
    });
}

// --- LOGICA COMANDI TASTIERA ---
process.stdin.on('keypress', async (str, key) => {
    if (key.ctrl && key.name === 'c') process.exit();
    if (str === 'c' && activeWsClient) {
        console.log("\n[Tastiera] Scatto manuale...");
        const text = await handleCameraTrigger();
        activeWsClient.send(JSON.stringify({ action: 'speak', text }));
        
        const chunks = splitTextIntoChunks(text, 500);
        for (let chunk of chunks) {
            const pcm = await getSingleTtsPcm(chunk, currentVolume);
            if (pcm) activeWsClient.send(pcm, { binary: true });
        }
    }
});

wss.on('connection', (ws) => {
    activeWsClient = ws;
    console.log("Dispositivo connesso.");
});

server.listen(3000, () => console.log("Server attivo. Premi 'c' per scattare."));
