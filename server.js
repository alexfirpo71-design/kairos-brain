import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket, WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';

const PORT = Number(process.env.PORT || 3000);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || '';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_HISTORY_MESSAGES = 10;
const SESSION_DURATION_MS = 20_000;
const FETCH_TIMEOUT_MS = 30_000;

const sessionHistories = new Map();
const clientsByMac = new Map();

function requireApiKey() {
    if (!GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY mancante.');
    }
}

function isWsOpen(ws) {
    return ws?.readyState === WebSocket.OPEN;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function sendJson(ws, payload) {
    if (isWsOpen(ws)) {
        ws.send(JSON.stringify(payload));
    }
}

function safeErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function readRequestBody(req, maxBytes) {
    const chunks = [];
    let totalBytes = 0;

    for await (const chunk of req) {
        totalBytes += chunk.length;

        if (totalBytes > maxBytes) {
            const error = new Error('Payload troppo grande.');
            error.statusCode = 413;
            throw error;
        }

        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

function writeText(res, statusCode, text) {
    if (res.headersSent || res.writableEnded) return;

    res.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(text);
}

function verifyUploadToken(req) {
    if (!UPLOAD_TOKEN) return true;

    const authorization = req.headers.authorization || '';
    return authorization === `Bearer ${UPLOAD_TOKEN}`;
}

function normalizeWakeText(text) {
    return text
        .toLocaleLowerCase('it-IT')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function hasAnyPhrase(text, phrases) {
    return phrases.some(phrase => text.includes(phrase));
}

function formatTimeForSpeech(text) {
    return text.replace(
        /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g,
        (_, hours, minutes) => {
            const hour = Number(hours);
            const minute = Number(minutes);

            let hourText;
            if (hour === 0) hourText = 'mezzanotte';
            else if (hour === 1) hourText = "l'una";
            else hourText = `le ${hour}`;

            if (minute === 0) return `${hourText} in punto`;
            if (minute < 10) return `${hourText} e zero ${minute}`;
            return `${hourText} e ${minute}`;
        }
    );
}

function splitTextIntoChunks(text, maxLength = 150) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    if (normalized.length <= maxLength) return [normalized];

    const sentences =
        normalized.match(/[^.!?]+(?:[.!?]+|$)/g)?.map(value => value.trim()) ||
        [normalized];

    const chunks = [];
    let current = '';

    const flushCurrent = () => {
        if (current) chunks.push(current.trim());
        current = '';
    };

    for (const sentence of sentences) {
        const candidate = current ? `${current} ${sentence}` : sentence;

        if (candidate.length <= maxLength) {
            current = candidate;
            continue;
        }

        flushCurrent();

        if (sentence.length <= maxLength) {
            current = sentence;
            continue;
        }

        for (const word of sentence.split(/\s+/)) {
            const wordCandidate = current ? `${current} ${word}` : word;

            if (wordCandidate.length <= maxLength) {
                current = wordCandidate;
            } else {
                flushCurrent();

                if (word.length <= maxLength) {
                    current = word;
                } else {
                    for (let i = 0; i < word.length; i += maxLength) {
                        chunks.push(word.slice(i, i + maxLength));
                    }
                }
            }
        }
    }

    flushCurrent();
    return chunks;
}

function sanitizeForSpeech(text) {
    return formatTimeForSpeech(text)
        .replace(/Kairós|Kairos|Kairòs/gi, 'Cairos')
        .replace(/[^\p{L}\p{N}\s.,?!'%-]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function runFfmpeg(inputBuffer, args) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', args, {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const stdoutChunks = [];
        const stderrChunks = [];

        ffmpeg.stdout.on('data', chunk => stdoutChunks.push(chunk));
        ffmpeg.stderr.on('data', chunk => stderrChunks.push(chunk));

        ffmpeg.on('error', reject);

        ffmpeg.on('close', code => {
            if (code === 0) {
                resolve(Buffer.concat(stdoutChunks));
                return;
            }

            const details = Buffer.concat(stderrChunks)
                .toString('utf8')
                .slice(-1000);

            reject(new Error(`FFmpeg terminato con codice ${code}: ${details}`));
        });

        ffmpeg.stdin.on('error', error => {
            if (error.code !== 'EPIPE') reject(error);
        });

        ffmpeg.stdin.end(inputBuffer);
    });
}

async function getSingleTtsPcm(textChunk, volumePercent, abortSignal) {
    const sanitizedText = sanitizeForSpeech(textChunk);
    if (!sanitizedText) return null;

    const params = new URLSearchParams({
        ie: 'UTF-8',
        q: sanitizedText,
        tl: 'it',
        client: 'tw-ob'
    });

    const response = await fetchWithTimeout(
        `[translate.google.com](https://translate.google.com/translate_tts?${params.toString()})`,
        {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            },
            signal: abortSignal
        },
        FETCH_TIMEOUT_MS
    );

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
            `Errore TTS HTTP ${response.status}: ${body.slice(0, 300)}`
        );
    }

    const mp3Buffer = Buffer.from(await response.arrayBuffer());
    const volumeFactor = clamp(volumePercent, 0, 100) / 70;

    return runFfmpeg(mp3Buffer, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-af',
        `volume=${Math.max(0.05, volumeFactor)},equalizer=f=300:width_type=o:width=2:g=2,acompressor=threshold=-20dB:ratio=2:attack=5:release=50,apad=pad_dur=0.25,afade=t=in:st=0:d=0.01`,
        '-f',
        's16le',
        '-acodec',
        'pcm_s16le',
        '-ac',
        '1',
        '-ar',
        '16000',
        'pipe:1'
    ]);
}

async function waitForWsDrain(ws, maxBufferedBytes = 65_536) {
    while (isWsOpen(ws) && ws.bufferedAmount > maxBufferedBytes) {
        await sleep(20);
    }
}

async function streamSpeech(ws, text) {
    if (!isWsOpen(ws) || !text?.trim()) return;

    if (ws.speechAbortController) {
        ws.speechAbortController.abort();
    }

    const controller = new AbortController();
    ws.speechAbortController = controller;
    ws.isSpeaking = true;

    sendJson(ws, {
        action: 'speak',
        text: text.trim()
    });

    try {
        for (const chunk of splitTextIntoChunks(text, 150)) {
            if (!isWsOpen(ws) || !ws.isSpeaking || controller.signal.aborted) {
                break;
            }

            const pcm = await getSingleTtsPcm(
                chunk,
                ws.volume,
                controller.signal
            );

            if (!pcm?.length) continue;

            for (let offset = 0; offset < pcm.length; offset += 4096) {
                if (!isWsOpen(ws) || !ws.isSpeaking || controller.signal.aborted) {
                    break;
                }

                await waitForWsDrain(ws);

                if (!isWsOpen(ws) || !ws.isSpeaking || controller.signal.aborted) {
                    break;
                }

                ws.send(pcm.subarray(offset, offset + 4096), {
                    binary: true
                });
            }

            await sleep(150);
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('[Errore Streaming Audio]', safeErrorMessage(error));
        }
    } finally {
        if (ws.speechAbortController === controller) {
            if (isWsOpen(ws)) sendJson(ws, { action: 'stop' });
            ws.isSpeaking = false;
            ws.speechAbortController = null;
            ws.sessionActiveUntil = Date.now() + SESSION_DURATION_MS;
        }
    }
}

function stopSpeaking(ws) {
    ws.isSpeaking = false;

    if (ws.speechAbortController) {
        ws.speechAbortController.abort();
        ws.speechAbortController = null;
    }

    sendJson(ws, { action: 'stop' });
}

function makeWavBuffer(pcmBuffer) {
    const header = Buffer.alloc(44);
    const dataLength = pcmBuffer.length;

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16_000, 24);
    header.writeUInt32LE(32_000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return Buffer.concat([header, pcmBuffer]);
}

async function transcribeAudio(audioBuffer) {
    requireApiKey();

    if (!audioBuffer?.length) {
        throw new Error('Audio vuoto.');
    }

    const formData = new FormData();
    formData.append('file', makeWavBuffer(audioBuffer), {
        filename: 'audio.wav',
        contentType: 'audio/wav'
    });
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'it');

    const response = await fetchWithTimeout(
        '[api.groq.com](https://api.groq.com/openai/v1/audio/transcriptions)',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${GROQ_API_KEY}`,
                ...formData.getHeaders()
            },
            body: formData
        },
        60_000
    );

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
            `Errore Whisper ${response.status}: ${body.slice(0, 500)}`
        );
    }

    const data = await response.json();
    return String(data.text || '').trim();
}

function cleanVisionResponse(text) {
    return String(text || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^```(?:text|markdown)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .replace(/^["']|["']$/g, '')
        .trim();
}

async function analyzeImage(imageBuffer, mimeType) {
    requireApiKey();

    const response = await fetchWithTimeout(
        '[api.groq.com](https://api.groq.com/openai/v1/chat/completions)',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b',
                messages: [
                    {
                        role: 'system',
                        content:
                            "Sei Kairós, l'assistente di Alessandro. Descrivi in italiano il testo visibile sul foglietto e ciò che lo circonda. Restituisci soltanto la risposta finale, senza analisi, markdown o tag."
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text:
                                    "Trascrivi il testo sul foglietto e descrivi cosa c'è intorno."
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${mimeType};base64,${imageBuffer.toString('base64')}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 250,
                temperature: 0.1
            })
        },
        60_000
    );

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
            `Errore Vision ${response.status}: ${body.slice(0, 500)}`
        );
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    const result = cleanVisionResponse(text);

    if (!result) {
        throw new Error('La risposta del modello Vision è vuota.');
    }

    return result;
}

function getPrivateContext(userName) {
    const configuredContext = process.env.KAIROS_PRIVATE_CONTEXT?.trim();

    if (!configuredContext) {
        return '';
    }

    return `
CONTESTO PRIVATO:
Usalo solo se ${userName} formula una domanda direttamente collegata.
Non menzionarlo spontaneamente.
${configuredContext}`;
}

async function getGroqChatResponse(history, userName = 'Alessandro') {
    requireApiKey();

    const safeName = String(userName || 'Alessandro')
        .replace(/[\r\n]/g, ' ')
        .slice(0, 50);

    const systemPrompt = `Sei Kairós, l'assistente IA di ${safeName}.
Parla sempre in italiano.
Rispondi in modo diretto, naturale e conciso.
Non inventare dati personali e non mostrare ragionamenti interni.
${getPrivateContext(safeName)}`;

    const response = await fetchWithTimeout(
        '[api.groq.com](https://api.groq.com/openai/v1/chat/completions)',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model:
                    process.env.GROQ_CHAT_MODEL ||
                    'llama-3.1-8b-instant',
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...history
                ],
                max_tokens: 300,
                temperature: 0.7
            })
        },
        45_000
    );

    if (!response.ok) {
        const body = await response.text().catch(() => '');

        if (response.status === 429) {
            throw new Error(
                'Troppe richieste in corso. Attendi qualche secondo.'
            );
        }

        throw new Error(
            `Errore Chat ${response.status}: ${body.slice(0, 500)}`
        );
    }

    const data = await response.json();
    const answer = String(
        data?.choices?.[0]?.message?.content || ''
    ).trim();

    if (!answer) {
        throw new Error('Risposta chat vuota.');
    }

    return answer;
}

function trimAndSaveHistory(ws) {
    if (ws.conversationHistory.length > MAX_HISTORY_MESSAGES) {
        ws.conversationHistory = ws.conversationHistory.slice(
            -MAX_HISTORY_MESSAGES
        );
    }

    if (ws.mac) {
        sessionHistories.set(ws.mac, ws.conversationHistory);
    }
}

function appendConversation(ws, role, content) {
    ws.conversationHistory.push({ role, content });
    trimAndSaveHistory(ws);
}

function findTargetClient(req) {
    const requestUrl = new URL(req.url, '[localhost](http://localhost)');
    const mac = requestUrl.searchParams.get('mac');

    if (mac) {
        return clientsByMac.get(mac) || null;
    }

    const openClients = [...clientsByMac.values()].filter(isWsOpen);
    if (openClients.length === 1) return openClients[0];

    return null;
}

async function handleUpload(req, res) {
    if (!verifyUploadToken(req)) {
        writeText(res, 401, 'Non autorizzato.');
        return;
    }

    const mimeType = String(req.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        writeText(
            res,
            415,
            'Formato non supportato. Usa JPEG, PNG o WebP.'
        );
        return;
    }

    const imageBuffer = await readRequestBody(req, MAX_IMAGE_BYTES);

    if (!imageBuffer.length) {
        writeText(res, 400, 'Immagine vuota o non ricevuta.');
        return;
    }

    console.log(`[HTTP] Immagine ricevuta: ${imageBuffer.length} byte.`);

    const resultText = await analyzeImage(imageBuffer, mimeType);
    console.log(`[Vision] ${resultText}`);

    writeText(res, 200, resultText);

    const targetClient = findTargetClient(req);
    if (targetClient) {
        void streamSpeech(targetClient, resultText);
    } else {
        console.warn(
            '[HTTP] Nessun client WebSocket univoco disponibile per il TTS.'
        );
    }
}

const server = createServer(async (req, res) => {
    try {
        const requestUrl = new URL(req.url, '[localhost](http://localhost)');

        if (req.method === 'POST' && requestUrl.pathname === '/upload') {
            await handleUpload(req, res);
            return;
        }

        if (req.method === 'GET' && requestUrl.pathname === '/health') {
            writeText(res, 200, 'ok');
            return;
        }

        writeText(res, 404, 'Endpoint non trovato.');
    } catch (error) {
        const statusCode = Number(error.statusCode) || 500;
        console.error('[Errore HTTP]', safeErrorMessage(error));

        writeText(
            res,
            statusCode,
            statusCode === 413
                ? 'Payload troppo grande.'
                : "Errore durante l'elaborazione della richiesta."
        );
    }
});

const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: MAX_AUDIO_BYTES
});

function queueWsTask(ws, task) {
    ws.messageQueue = ws.messageQueue
        .then(task)
        .catch(error => {
            console.error('[Errore coda WS]', safeErrorMessage(error));
        });

    return ws.messageQueue;
}

async function processRecordedAudio(ws) {
    const completeAudioBuffer = Buffer.concat(ws.audioChunks);
    ws.audioChunks = [];
    ws.audioBytes = 0;

    if (!completeAudioBuffer.length) {
        console.log('[WS] Registrazione vuota ignorata.');
        return;
    }

    let replyText;

    try {
        const transcript = await transcribeAudio(completeAudioBuffer);
        console.log(`[Whisper] "${transcript}"`);

        if (!transcript) return;

        const rawText = normalizeWakeText(transcript);
        const now = Date.now();
        const isSessionActive = now < ws.sessionActiveUntil;

        const hasWakeWord = hasAnyPhrase(rawText, [
            'kairos',
            'cairos',
            'cairo',
            'ehi'
        ]);

        if (!isSessionActive && !hasWakeWord) {
            console.log(`[Ignorato] "${transcript}"`);
            return;
        }

        ws.sessionActiveUntil = now + SESSION_DURATION_MS;

        if (
            hasAnyPhrase(rawText, [
                'stop',
                'fermati',
                'basta',
                'silenzio'
            ])
        ) {
            stopSpeaking(ws);
            ws.sessionActiveUntil = 0;
            return;
        }

        if (
            hasAnyPhrase(rawText, [
                'alza',
                'piu alto',
                'volume su'
            ])
        ) {
            ws.volume = clamp(ws.volume + 15, 10, 100);
            replyText = `Volume al ${ws.volume} per cento.`;
        } else if (
            hasAnyPhrase(rawText, [
                'abbassa',
                'piu basso',
                'volume giu'
            ])
        ) {
            ws.volume = clamp(ws.volume - 15, 10, 100);
            replyText = `Volume al ${ws.volume} per cento.`;
        } else if (
            hasAnyPhrase(rawText, [
                'telecamera',
                'guarda',
                'inquadra',
                'biglietto'
            ])
        ) {
            sendJson(ws, {
                action: 'trigger_camera',
                text: 'Scatto la foto...'
            });
            replyText = 'Un attimo, guardo subito.';
        } else {
            const onlyWakeWords = new Set([
                'kairos',
                'ehi kairos',
                'cairos',
                'ehi cairos',
                'ehi',
                'cairo'
            ]);

            if (!isSessionActive && onlyWakeWords.has(rawText)) {
                replyText = `Dimmi pure, ${ws.userName}.`;
            } else {
                appendConversation(ws, 'user', transcript);
                replyText = await getGroqChatResponse(
                    ws.conversationHistory,
                    ws.userName
                );
                appendConversation(ws, 'assistant', replyText);

                await streamSpeech(ws, replyText);
                return;
            }
        }

        appendConversation(ws, 'user', transcript);
        appendConversation(ws, 'assistant', replyText);
    } catch (error) {
        console.error('[Errore IA]', safeErrorMessage(error));
        replyText = "Si è verificato un errore di elaborazione.";
    }

    if (replyText) {
        await streamSpeech(ws, replyText);
    }
}

function handleWsMetadata(ws, data) {
    if (typeof data.user === 'string' && data.user.trim()) {
        ws.userName = data.user.trim().slice(0, 50);
    }

    if (typeof data.mac === 'string' && data.mac.trim()) {
        const mac = data.mac.trim().toUpperCase();

        if (ws.mac && clientsByMac.get(ws.mac) === ws) {
            clientsByMac.delete(ws.mac);
        }

        ws.mac = mac;
        clientsByMac.set(mac, ws);

        if (!sessionHistories.has(mac)) {
            sessionHistories.set(mac, []);
        }

        ws.conversationHistory = sessionHistories.get(mac);
    }
}

wss.on('connection', (ws, req) => {
    console.log(`[WS] Connessione da ${req.socket.remoteAddress}`);

    ws.userName = 'Alessandro';
    ws.mac = null;
    ws.volume = 70;
    ws.conversationHistory = [];
    ws.audioChunks = [];
    ws.audioBytes = 0;
    ws.isSpeaking = false;
    ws.sessionActiveUntil = 0;
    ws.speechAbortController = null;
    ws.messageQueue = Promise.resolve();
    ws.isAlive = true;

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (message, isBinary) => {
        if (isBinary) {
            if (ws.isSpeaking) return;

            ws.audioBytes += message.length;

            if (ws.audioBytes > MAX_AUDIO_BYTES) {
                ws.audioChunks = [];
                ws.audioBytes = 0;
                sendJson(ws, {
                    action: 'error',
                    text: 'Registrazione troppo lunga.'
                });
                return;
            }

            ws.audioChunks.push(Buffer.from(message));
            return;
        }

        let data;

        try {
            data = JSON.parse(message.toString());
        } catch {
            console.warn('[WS] Messaggio JSON non valido.');
            return;
        }

        if (data.action === 'stop') {
            stopSpeaking(ws);
            ws.audioChunks = [];
            ws.audioBytes = 0;
            return;
        }

        handleWsMetadata(ws, data);

        const isMetadataMessage =
            data.mac ||
            data.device ||
            data.user ||
            data.location ||
            data.status;

        if (isMetadataMessage && data.state !== 'processing') {
            return;
        }

        if (data.state === 'processing') {
            queueWsTask(ws, () => processRecordedAudio(ws));
        }
    });

    ws.on('error', error => {
        console.error('[Errore WS]', safeErrorMessage(error));
    });

    ws.on('close', () => {
        stopSpeaking(ws);

        if (ws.mac && clientsByMac.get(ws.mac) === ws) {
            clientsByMac.delete(ws.mac);
        }

        console.log('[WS] Connessione chiusa.');
    });
});

const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
        if (!ws.isAlive) {
            ws.terminate();
            continue;
        }

        ws.isAlive = false;
        ws.ping();
    }
}, 30_000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

server.listen(PORT, () => {
    console.log(`Server Kairós in ascolto sulla porta ${PORT}`);
});
