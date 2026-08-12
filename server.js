Certo. Ti lascio il **file Node.js completo**, già integrato con le modifiche: lettura OCR più completa e senza descrizioni inutili, riconoscimento di più comandi vocali per la fotocamera, mantenimento della lingua originale del testo fotografato e gestione più robusta degli errori.

Una precisazione importante: **questo codice elimina il bisogno del tasto `C` solo se il firmware ESP32 è già programmato per attivare l'ascolto tramite wake word/comando vocale**. Nel server qui sotto non esiste alcuna dipendenza dal tasto `C`; se attualmente `C` avvia la registrazione, quella parte va modificata nel firmware ESP32.

# Server Kairós — versione completa

```javascript
import http, { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { spawn } from 'child_process';

// ============================================================
// CONFIGURAZIONE
// ============================================================

const PORT = process.env.PORT || 3000;

const CAMERA_URL = 'http://192.168.1.154:8080/shot.jpg';

const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
    console.error('[ERRORE] GROQ_API_KEY non configurata.');
}

// WebSocket attivo
let activeWsClient = null;

// Volume TTS globale
let currentVolume = 70;

// Memorie conversazioni per dispositivo
const sessionHistories = new Map();


// ============================================================
// FUNZIONI UTILI
// ============================================================

function formatTimeForSpeech(text) {
    return text.replace(
        /\b([0-2]?[0-9])[:\.]([0-5][0-9])\b/g,
        (match, hours, minutes) => {

            const h = parseInt(hours, 10);
            const m = parseInt(minutes, 10);

            let hourText;

            if (h === 1) {
                hourText = "l'una";
            } else if (h === 0) {
                hourText = "le ore zero";
            } else {
                hourText = `le ${h}`;
            }

            if (m === 0) {
                return `${hourText} in punto`;
            }

            if (m < 10) {
                return `${hourText} e zero ${m}`;
            }

            return `${hourText} e ${m}`;
        }
    );
}


function splitTextIntoChunks(text, maxLength = 250) {

    if (!text || text.length <= maxLength) {
        return [text];
    }

    const sentences =
        text.match(/[^.!?]+[.!?]+["']?|.+$/g) || [text];

    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {

        if ((currentChunk + sentence).length <= maxLength) {

            currentChunk += sentence;

        } else {

            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }

            if (sentence.length > maxLength) {

                const words = sentence.split(' ');
                let subChunk = '';

                for (const word of words) {

                    if (
                        (subChunk + ' ' + word).length <=
                        maxLength
                    ) {

                        subChunk +=
                            (subChunk ? ' ' : '') + word;

                    } else {

                        if (subChunk) {
                            chunks.push(subChunk.trim());
                        }

                        subChunk = word;
                    }
                }

                currentChunk = subChunk;

            } else {

                currentChunk = sentence;
            }
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}


// ============================================================
// TTS
// ============================================================

async function getSingleTtsPcm(textChunk, volumePercent) {

    try {

        const timeFormatted =
            formatTimeForSpeech(textChunk);

        // Pronuncia corretta del nome Kairós
        const speechFriendlyText =
            timeFormatted.replace(
                /Kairós|Kairos|Kairòs/gi,
                'Cairos'
            );

        const sanitizedText =
            speechFriendlyText
                .replace(
                    /[^\w\sàèéìòùÀÈÉÌÒÙ.,?!'’:-]/g,
                    ''
                )
                .trim();

        if (!sanitizedText) {
            return null;
        }

        const cleanText =
            encodeURIComponent(sanitizedText);

        const ttsUrl =
            `https://translate.google.com/translate_tts` +
            `?ie=UTF-8` +
            `&q=${cleanText}` +
            `&tl=it` +
            `&client=tw-ob`;

        const response = await fetch(ttsUrl, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        if (!response.ok) {

            console.error(
                `[Errore TTS] HTTP ${response.status}`
            );

            throw new Error(
                `Errore TTS HTTP: ${response.status}`
            );
        }

        const arrayBuffer =
            await response.arrayBuffer();

        const mp3Buffer =
            Buffer.from(arrayBuffer);

        // 70 = volume normale
        const volumeFactor =
            Math.max(
                0.05,
                volumePercent / 70
            );

        const pcmBuffer =
            await new Promise((resolve, reject) => {

                const ffmpeg = spawn('ffmpeg', [
                    '-i',
                    'pipe:0',

                    '-af',
                    `volume=${volumeFactor},` +
                    `equalizer=f=300:width_type=o:width=2:g=2,` +
                    `acompressor=threshold=-20dB:` +
                    `ratio=2:attack=5:release=50`,

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

                const chunks = [];

                ffmpeg.stdout.on(
                    'data',
                    chunk => chunks.push(chunk)
                );

                ffmpeg.on('close', code => {

                    if (code === 0) {

                        resolve(
                            Buffer.concat(chunks)
                        );

                    } else {

                        reject(
                            new Error(
                                `FFmpeg exited with code ${code}`
                            )
                        );
                    }
                });

                ffmpeg.on(
                    'error',
                    reject
                );

                ffmpeg.stdin.write(mp3Buffer);
                ffmpeg.stdin.end();
            });

        // 250 ms circa a 16 kHz
        const silenceSamples = 4000;

        let paddedPcmBuffer =
            Buffer.concat([
                pcmBuffer,
                Buffer.alloc(silenceSamples * 2)
            ]);

        // Fade in
        const fadeSamplesIn =
            Math.min(
                120,
                paddedPcmBuffer.length / 2
            );

        for (
            let i = 0;
            i < fadeSamplesIn;
            i++
        ) {

            const sample =
                paddedPcmBuffer.readInt16LE(i * 2);

            const multiplier =
                i / fadeSamplesIn;

            paddedPcmBuffer.writeInt16LE(
                Math.floor(
                    sample * multiplier
                ),
                i * 2
            );
        }

        // Fade out
        const fadeSamplesOut =
            silenceSamples;

        const startOutIdx =
            paddedPcmBuffer.length / 2 -
            fadeSamplesOut;

        for (
            let i = 0;
            i < fadeSamplesOut;
            i++
        ) {

            const idx =
                (startOutIdx + i) * 2;

            const sample =
                paddedPcmBuffer.readInt16LE(idx);

            const multiplier =
                (fadeSamplesOut - i) /
                fadeSamplesOut;

            paddedPcmBuffer.writeInt16LE(
                Math.floor(
                    sample * multiplier
                ),
                idx
            );
        }

        return paddedPcmBuffer;

    } catch (err) {

        console.error(
            '[Errore TTS Singolo]',
            err.message
        );

        return null;
    }
}


// ============================================================
// WHISPER - TRASCRIZIONE AUDIO
// ============================================================

async function transcribeAudio(audioBuffer) {

    if (!GROQ_API_KEY) {
        throw new Error(
            'GROQ_API_KEY mancante.'
        );
    }

    if (
        !audioBuffer ||
        audioBuffer.length === 0
    ) {
        throw new Error(
            'Buffer audio vuoto.'
        );
    }

    const dataLength =
        audioBuffer.length;

    const fileLength =
        dataLength + 36;

    // WAV PCM 16 bit / mono / 16 kHz
    const header = Buffer.from([
        0x52, 0x49, 0x46, 0x46,

        fileLength & 0xff,
        (fileLength >> 8) & 0xff,
        (fileLength >> 16) & 0xff,
        (fileLength >> 24) & 0xff,

        0x57, 0x41, 0x56, 0x45,

        0x66, 0x6d, 0x74, 0x20,

        16, 0, 0, 0,

        1, 0,

        1, 0,

        16000 & 0xff,
        (16000 >> 8) & 0xff,
        (16000 >> 16) & 0xff,
        (16000 >> 24) & 0xff,

        32000 & 0xff,
        (32000 >> 8) & 0xff,
        (32000 >> 16) & 0xff,
        (32000 >> 24) & 0xff,

        2, 0,

        16, 0,

        0x64, 0x61, 0x74, 0x61,

        dataLength & 0xff,
        (dataLength >> 8) & 0xff,
        (dataLength >> 16) & 0xff,
        (dataLength >> 24) & 0xff
    ]);

    const wavBuffer =
        Buffer.concat([
            header,
            audioBuffer
        ]);

    const formData =
        new FormData();

    formData.append(
        'file',
        wavBuffer,
        {
            filename: 'audio.wav',
            contentType: 'audio/wav'
        }
    );

    formData.append(
        'model',
        'whisper-large-v3'
    );

    formData.append(
        'language',
        'it'
    );

    const response = await fetch(
        'https://api.groq.com/openai/v1/audio/transcriptions',
        {
            method: 'POST',

            headers: {
                'Authorization':
                    `Bearer ${GROQ_API_KEY}`,

                ...formData.getHeaders()
            },

            body: formData
        }
    );

    if (!response.ok) {

        const errorText =
            await response.text();

        console.error(
            `[Whisper] ${response.status}: ${errorText}`
        );

        throw new Error(
            `Errore Whisper: ${response.status}`
        );
    }

    const data =
        await response.json();

    return data.text || '';
}


// ============================================================
// CHAT NORMALE
// ============================================================

async function getGroqChatResponse(
    conversationHistory,
    userName = 'Alessandro'
) {

    if (!GROQ_API_KEY) {
        throw new Error(
            'GROQ_API_KEY mancante.'
        );
    }

    const systemPrompt = `
Sei Kairós, l'assistente IA vocale avanzato di ${userName}.

Parla sempre in italiano.

Rispondi in modo diretto, naturale e relativamente breve.

Non fare lunghe introduzioni.

Non ripetere inutilmente la domanda dell'utente.

Quando l'utente chiede qualcosa di semplice, dai una risposta semplice.

Se l'utente chiede di leggere una fotografia, la lettura della fotografia viene gestita separatamente dal sistema Vision.

Non inventare informazioni.
`;

    const messages = [
        {
            role: 'system',
            content: systemPrompt
        },
        ...conversationHistory
    ];

    const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
            method: 'POST',

            headers: {
                'Authorization':
                    `Bearer ${GROQ_API_KEY}`,

                'Content-Type':
                    'application/json'
            },

            body: JSON.stringify({

                model:
                    'llama-3.1-8b-instant',

                messages,

                max_tokens:
                    300,

                temperature:
                    0.7
            })
        }
    );

    if (!response.ok) {

        if (response.status === 429) {
            throw new Error(
                'Troppe richieste in corso. Attendi qualche secondo.'
            );
        }

        const errorText =
            await response.text();

        console.error(
            `[Chat] ${response.status}: ${errorText}`
        );

        throw new Error(
            `Errore Chat: ${response.status}`
        );
    }

    const data =
        await response.json();

    return (
        data?.choices?.[0]?.message?.content ||
        'Non ho ricevuto una risposta.'
    );
}


// ============================================================
// LETTURA FOTOGRAFIA
// ============================================================

async function handleCameraTrigger(ws) {

    console.log(
        '[Camera] Comando vocale ricevuto.'
    );

    console.log(
        '[Camera] Scatto in corso...'
    );

    try {

        // --------------------------------------------------------
        // 1. SCATTA FOTO
        // --------------------------------------------------------

        const imageBuffer =
            await new Promise((resolve, reject) => {

                const req =
                    http.get(
                        CAMERA_URL,
                        res => {

                            if (
                                res.statusCode !== 200
                            ) {

                                reject(
                                    new Error(
                                        `Errore telecamera HTTP ${res.statusCode}`
                                    )
                                );

                                return;
                            }

                            const chunks = [];

                            res.on(
                                'data',
                                chunk =>
                                    chunks.push(chunk)
                            );

                            res.on(
                                'end',
                                () =>
                                    resolve(
                                        Buffer.concat(chunks)
                                    )
                            );
                        }
                    );

                req.on(
                    'error',
                    reject
                );

                req.setTimeout(
                    5000,
                    () => {

                        req.destroy();

                        reject(
                            new Error(
                                'Timeout di connessione alla telecamera'
                            )
                        );
                    }
                );
            });

        console.log(
            `[Camera] Foto ricevuta: ${imageBuffer.length} byte`
        );


        // --------------------------------------------------------
        // 2. VISION / OCR
        // --------------------------------------------------------

        const base64Image =
            imageBuffer.toString('base64');

        const visionResponse =
            await fetch(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    method: 'POST',

                    headers: {
                        'Authorization':
                            `Bearer ${GROQ_API_KEY}`,

                        'Content-Type':
                            'application/json'
                    },

                    body: JSON.stringify({

                        model:
                            'qwen/qwen3.6-27b',

                        messages: [

                            {
                                role: 'system',

                                content: `
Sei Kairós, un assistente vocale specializzato nella lettura di fotografie.

IL TUO COMPITO È LEGGERE IL TESTO.

Devi trascrivere TUTTO il testo visibile e leggibile nell'immagine.

Non fare una descrizione generale della fotografia.

NON descrivere:
- tavoli
- pareti
- sfondi
- colori
- oggetti intorno
- forma del foglio
- ambiente

a meno che l'utente lo chieda esplicitamente.

Devi invece leggere:
- titoli
- intestazioni
- paragrafi
- righe
- numeri
- date
- orari
- indirizzi
- prezzi
- nomi
- sigle
- codici
- avvisi
- etichette
- tutto il testo secondario leggibile

Leggi il testo dall'alto verso il basso e, quando necessario, da sinistra verso destra.

MANTIENI LA LINGUA ORIGINALE.

Se trovi italiano, mantieni l'italiano.

Se trovi inglese, mantieni l'inglese.

Se trovi contemporaneamente italiano e inglese, leggi entrambe le lingue così come sono scritte.

NON TRADURRE.

NON riassumere.

NON correggere il testo.

NON sostituire parole con sinonimi.

Se una parola è poco leggibile, fai la migliore trascrizione possibile.

Se una parte è realmente illeggibile, puoi dire brevemente "parola illeggibile".

Non aggiungere commenti personali.

La risposta deve essere pronta per essere letta a voce.

NON iniziare con frasi come:
"Ho analizzato l'immagine",
"Vedo un foglio",
"Nella fotografia si vede",
"La foto mostra".

Inizia direttamente con il testo trovato.

Se non c'è alcun testo leggibile, rispondi soltanto:

"Non riesco a leggere alcun testo nell'immagine."
`
                            },

                            {
                                role: 'user',

                                content: [

                                    {
                                        type: 'text',

                                        text: `
Leggi tutto il testo visibile nella fotografia.

Non descrivere la fotografia.

Trascrivi il testo completo, senza riassumerlo e senza tradurlo.

Mantieni l'ordine di lettura dall'alto verso il basso.
`
                                    },

                                    {
                                        type: 'image_url',

                                        image_url: {
                                            url:
                                                `data:image/jpeg;base64,${base64Image}`
                                        }
                                    }
                                ]
                            }
                        ],

                        max_tokens:
                            800,

                        temperature:
                            0.0
                    })
                }
            );


        if (!visionResponse.ok) {

            const errorBody =
                await visionResponse.text();

            console.error(
                `[Vision] ${visionResponse.status}: ${errorBody}`
            );

            throw new Error(
                `Errore API Vision: ${visionResponse.status}`
            );
        }


        // --------------------------------------------------------
        // 3. RISPOSTA OCR
        // --------------------------------------------------------

        const visionData =
            await visionResponse.json();

        let description =
            visionData
                ?.choices?.[0]
                ?.message
                ?.content
                ?.trim() || '';

        // Elimina eventuale ragionamento restituito dal modello
        description =
            description
                .replace(
                    /<think>[\s\S]*?<\/think>/gi,
                    ''
                )
                .trim();

        // Rimuove eventuali spazi multipli
        description =
            description.replace(
                /[ \t]+/g,
                ' '
            );

        if (!description) {

            description =
                'Non riesco a leggere alcun testo nell’immagine.';
        }

        console.log(
            `[OCR] "${description}"`
        );

        return description;

    } catch (err) {

        console.error(
            '[Errore Camera]',
            err.message
        );

        return (
            'Non sono riuscito a leggere la fotografia.'
        );
    }
}


// ============================================================
// STREAMING TTS
// ============================================================

async function speakText(ws, text) {

    if (
        !ws ||
        ws.readyState !== ws.OPEN
    ) {
        return;
    }

    if (!text || !text.trim()) {
        return;
    }

    ws.isSpeaking = true;

    ws.send(
        JSON.stringify({
            action: 'speak',
            text: text.trim()
        })
    );

    try {

        const textChunks =
            splitTextIntoChunks(
                text,
                150
            );

        for (
            const chunk of textChunks
        ) {

            if (
                ws.readyState !== ws.OPEN ||
                !ws.isSpeaking
            ) {
                break;
            }

            const pcmPart =
                await getSingleTtsPcm(
                    chunk,
                    currentVolume
                );

            if (
                !pcmPart ||
                pcmPart.length === 0
            ) {
                continue;
            }

            const chunkSize = 4096;

            for (
                let i = 0;
                i < pcmPart.length;
                i += chunkSize
            ) {

                if (
                    ws.readyState !== ws.OPEN ||
                    !ws.isSpeaking
                ) {
                    break;
                }

                while (
                    ws.bufferedAmount > 65536
                ) {

                    await new Promise(
                        resolve =>
                            setTimeout(
                                resolve,
                                20
                            )
                    );

                    if (
                        ws.readyState !== ws.OPEN ||
                        !ws.isSpeaking
                    ) {
                        break;
                    }
                }

                if (
                    ws.readyState !== ws.OPEN ||
                    !ws.isSpeaking
                ) {
                    break;
                }

                const end =
                    Math.min(
                        i + chunkSize,
                        pcmPart.length
                    );

                ws.send(
                    pcmPart.subarray(
                        i,
                        end
                    ),
                    {
                        binary: true
                    }
                );
            }
        }

        if (
            ws.isSpeaking &&
            ws.readyState === ws.OPEN
        ) {

            ws.send(
                JSON.stringify({
                    action: 'stop'
                })
            );
        }

    } catch (err) {

        console.error(
            '[Errore Streaming Audio]',
            err
        );

    } finally {

        ws.isSpeaking = false;
    }
}


// ============================================================
// SERVER HTTP
// ============================================================

const server =
    createServer(
        async (req, res) => {

            // ----------------------------------------------------
            // UPLOAD ESP32
            // ----------------------------------------------------

            if (
                req.method === 'POST' &&
                req.url === '/upload'
            ) {

                const buffers = [];

                req.on(
                    'data',
                    chunk =>
                        buffers.push(chunk)
                );

                req.on(
                    'end',
                    async () => {

                        const imageBuffer =
                            Buffer.concat(
                                buffers
                            );

                        try {

                            if (
                                !imageBuffer ||
                                imageBuffer.length === 0
                            ) {

                                res.writeHead(
                                    400,
                                    {
                                        'Content-Type':
                                            'text/plain; charset=utf-8'
                                    }
                                );

                                res.end(
                                    'Immagine vuota o non ricevuta.'
                                );

                                return;
                            }

                            console.log(
                                '[Server] Immagine ricevuta tramite POST.'
                            );

                            const base64Image =
                                imageBuffer.toString(
                                    'base64'
                                );

                            const visionResponse =
                                await fetch(
                                    'https://api.groq.com/openai/v1/chat/completions',
                                    {
                                        method: 'POST',

                                        headers: {
                                            'Authorization':
                                                `Bearer ${GROQ_API_KEY}`,

                                            'Content-Type':
                                                'application/json'
                                        },

                                        body: JSON.stringify({

                                            model:
                                                'qwen/qwen3.6-27b',

                                            messages: [

                                                {
                                                    role: 'system',

                                                    content: `
Sei Kairós.

Devi leggere il testo presente nella fotografia.

Trascrivi TUTTO il testo leggibile.

Non descrivere lo sfondo, il tavolo, il foglio o gli oggetti circostanti.

Mantieni la lingua originale.

Non tradurre.

Non riassumere.

Non omettere righe leggibili.

Rispondi direttamente con il testo da leggere a voce.

Se non trovi testo leggibile, dì:
"Non riesco a leggere alcun testo nell'immagine."
`
                                                },

                                                {
                                                    role: 'user',

                                                    content: [

                                                        {
                                                            type: 'text',

                                                            text:
                                                                'Leggi tutto il testo visibile nella fotografia, mantenendo la lingua originale.'
                                                        },

                                                        {
                                                            type: 'image_url',

                                                            image_url: {
                                                                url:
                                                                    `data:image/jpeg;base64,${base64Image}`
                                                            }
                                                        }
                                                    ]
                                                }
                                            ],

                                            max_tokens:
                                                800,

                                            temperature:
                                                0.0
                                        })
                                    }
                                );


                            if (
                                !visionResponse.ok
                            ) {

                                const errorBody =
                                    await visionResponse.text();

                                console.error(
                                    `[Groq Vision] ${visionResponse.status}: ${errorBody}`
                                );

                                throw new Error(
                                    `Errore API: ${visionResponse.status}`
                                );
                            }


                            const visionData =
                                await visionResponse.json();

                            let rawText =
                                visionData
                                    ?.choices?.[0]
                                    ?.message
                                    ?.content
                                    ?.trim() || '';

                            let resultText =
                                rawText
                                    .replace(
                                        /<think>[\s\S]*?<\/think>/gi,
                                        ''
                                    )
                                    .trim();

                            if (!resultText) {
                                resultText =
                                    'Non riesco a leggere alcun testo nell’immagine.';
                            }

                            console.log(
                                `[Risposta Monitor] "${resultText}"`
                            );


                            // ------------------------------------------------
                            // Risposta HTTP
                            // ------------------------------------------------

                            res.writeHead(
                                200,
                                {
                                    'Content-Type':
                                        'text/plain; charset=utf-8'
                                }
                            );

                            res.end(
                                `Immagine ricevuta ed elaborata con successo: ${resultText}`
                            );


                            // ------------------------------------------------
                            // TTS WS
                            // ------------------------------------------------

                            if (
                                activeWsClient &&
                                activeWsClient.readyState ===
                                    activeWsClient.OPEN
                            ) {

                                console.log(
                                    '[WS] Invio lettura immagine all’ESP32.'
                                );

                                await speakText(
                                    activeWsClient,
                                    resultText
                                );
                            }

                        } catch (err) {

                            console.error(
                                '[Errore Upload]',
                                err.message
                            );

                            if (!res.headersSent) {

                                res.writeHead(
                                    500,
                                    {
                                        'Content-Type':
                                            'text/plain; charset=utf-8'
                                    }
                                );

                                res.end(
                                    'Errore interno del server durante l’elaborazione dell’immagine.'
                                );
                            }
                        }
                    }
                );

                return;
            }


            // ----------------------------------------------------
            // SERVER ONLINE
            // ----------------------------------------------------

            res.writeHead(
                200,
                {
                    'Content-Type':
                        'text/plain; charset=utf-8'
                }
            );

            res.end(
                'Kairos Brain Server is running!\n'
            );
        }
    );


// ============================================================
// WEBSOCKET SERVER
// ============================================================

const wss =
    new WebSocketServer({
        server,
        path: '/ws'
    });


// ============================================================
// CONNESSIONE ESP32
// ============================================================

wss.on(
    'connection',
    (ws, req) => {

        console.log(
            `[WS] Connesso da: ${req.socket.remoteAddress}`
        );

        // Ultimo dispositivo connesso
        activeWsClient = ws;

        ws.userName = 'Alessandro';

        ws.conversationHistory = [];

        ws.isSpeaking = false;

        ws.mac = null;

        let audioBuffer = [];

        // Sessione vocale
        let sessionActiveUntil = 0;

        const SESSION_DURATION_MS =
            20000;


        // --------------------------------------------------------
        // HEARTBEAT
        // --------------------------------------------------------

        ws.isAlive = true;

        ws.on(
            'pong',
            () => {
                ws.isAlive = true;
            }
        );

        const pingInterval =
            setInterval(
                () => {

                    if (
                        ws.isAlive === false
                    ) {

                        clearInterval(
                            pingInterval
                        );

                        return ws.terminate();
                    }

                    ws.isAlive = false;

                    ws.ping();

                },
                30000
            );


        // --------------------------------------------------------
        // MESSAGGI
        // --------------------------------------------------------

        ws.on(
            'message',
            async (
                message,
                isBinary
            ) => {

                // ==================================================
                // AUDIO
                // ==================================================

                if (isBinary) {

                    // Non registrare mentre Kairós sta parlando
                    if (ws.isSpeaking) {
                        return;
                    }

                    audioBuffer.push(
                        message
                    );

                    return;
                }


                // ==================================================
                // JSON
                // ==================================================

                try {

                    const data =
                        JSON.parse(
                            message.toString()
                        );


                    // ------------------------------------------------
                    // STOP
                    // ------------------------------------------------

                    if (
                        data.action === 'stop'
                    ) {

                        console.log(
                            '[WS] Stop ricevuto dall’ESP32.'
                        );

                        ws.isSpeaking = false;

                        audioBuffer = [];

                        return;
                    }


                    // ------------------------------------------------
                    // DATI DISPOSITIVO
                    // ------------------------------------------------

                    if (data.user) {
                        ws.userName =
                            data.user;
                    }

                    if (data.mac) {

                        ws.mac =
                            data.mac;

                        if (
                            !sessionHistories.has(
                                data.mac
                            )
                        ) {

                            sessionHistories.set(
                                data.mac,
                                []
                            );
                        }

                        ws.conversationHistory =
                            sessionHistories.get(
                                data.mac
                            );
                    }


                    // Messaggi di stato
                    if (
                        data.mac ||
                        data.device ||
                        data.user ||
                        data.location ||
                        data.status
                    ) {

                        return;
                    }


                    // ==================================================
                    // FINE REGISTRAZIONE
                    // ==================================================

                    if (
                        data.state === 'processing'
                    ) {

                        const completeAudioBuffer =
                            Buffer.concat(
                                audioBuffer
                            );

                        audioBuffer = [];


                        if (
                            completeAudioBuffer.length === 0
                        ) {

                            console.log(
                                '[Audio] Buffer vuoto.'
                            );

                            return;
                        }


                        let replyText = null;


                        try {

                            // ------------------------------------------------
                            // WHISPER
                            // ------------------------------------------------

                            const transcript =
                                await transcribeAudio(
                                    completeAudioBuffer
                                );

                            console.log(
                                `[Whisper] "${transcript}"`
                            );


                            if (
                                transcript &&
                                transcript.trim().length > 0
                            ) {

                                // Normalizzazione
                                const rawText =
                                    transcript
                                        .toLowerCase()
                                        .replace(
                                            /[.,\/$%\^&\*;:{}=\-_`~()?]/g,
                                            ''
                                        )
                                        .trim();

                                const now =
                                    Date.now();

                                const isSessionActive =
                                    now <
                                    sessionActiveUntil;


                                // ------------------------------------------------
                                // WAKE WORD
                                // ------------------------------------------------

                                const hasWakeWord =
                                    rawText.includes('kairos') ||
                                    rawText.includes('cairos') ||
                                    rawText.includes('cairo') ||
                                    rawText.includes('ehi kairos') ||
                                    rawText.includes('ehi cairos') ||
                                    rawText.includes('ehi');


                                // Se non siamo in sessione e non viene
                                // pronunciata la wake word, ignoriamo
                                if (
                                    !isSessionActive &&
                                    !hasWakeWord
                                ) {

                                    console.log(
                                        `[Ignorato] "${transcript}"`
                                    );

                                    return;
                                }


                                // Estende la sessione
                                sessionActiveUntil =
                                    now +
                                    SESSION_DURATION_MS;


                                // ==================================================
                                // STOP VOCALE
                                // ==================================================

                                if (
                                    rawText.includes('stop') ||
                                    rawText.includes('fermati') ||
                                    rawText.includes('basta') ||
                                    rawText.includes('silenzio') ||
                                    rawText.includes('smettila')
                                ) {

                                    ws.isSpeaking = false;

                                    if (
                                        ws.readyState ===
                                        ws.OPEN
                                    ) {

                                        ws.send(
                                            JSON.stringify({
                                                action:
                                                    'stop'
                                            })
                                        );
                                    }

                                    sessionActiveUntil =
                                        0;

                                    console.log(
                                        '[Comando] Stop vocale.'
                                    );

                                    return;
                                }


                                // ==================================================
                                // VOLUME SU
                                // ==================================================

                                if (
                                    rawText.includes('alza il volume') ||
                                    rawText.includes('alza volume') ||
                                    rawText.includes('piu alto') ||
                                    rawText.includes('più alto') ||
                                    rawText.includes('volume su')
                                ) {

                                    currentVolume =
                                        Math.min(
                                            100,
                                            currentVolume + 15
                                        );

                                    replyText =
                                        `Volume al ${currentVolume} per cento.`;
                                }


                                // ==================================================
                                // VOLUME GIÙ
                                // ==================================================

                                else if (
                                    rawText.includes('abbassa il volume') ||
                                    rawText.includes('abbassa volume') ||
                                    rawText.includes('piu basso') ||
                                    rawText.includes('più basso') ||
                                    rawText.includes('volume giu') ||
                                    rawText.includes('volume giù')
                                ) {

                                    currentVolume =
                                        Math.max(
                                            10,
                                            currentVolume - 15
                                        );

                                    replyText =
                                        `Volume al ${currentVolume} per cento.`;
                                }


                                // ==================================================
                                // FOTOCAMERA / LETTURA TESTO
                                // ==================================================

                                else if (
                                    rawText.includes('telecamera') ||
                                    rawText.includes('fotocamera') ||
                                    rawText.includes('fotografa') ||
                                    rawText.includes('fotografami') ||
                                    rawText.includes('scatta') ||
                                    rawText.includes('fai una foto') ||
                                    rawText.includes('guarda') ||
                                    rawText.includes('inquadra') ||
                                    rawText.includes('leggi') ||
                                    rawText.includes('leggimi') ||
                                    rawText.includes('cosa ce scritto') ||
                                    rawText.includes('cosa c e scritto') ||
                                    rawText.includes('cosa c’è scritto') ||
                                    rawText.includes('leggi questo') ||
                                    rawText.includes('leggi il biglietto') ||
                                    rawText.includes('leggi il foglio') ||
                                    rawText.includes('leggi il foglietto') ||
                                    rawText.includes('biglietto') ||
                                    rawText.includes('foglietto') ||
                                    rawText.includes('foglio')
                                ) {

                                    console.log(
                                        '[WS] Comando vocale fotocamera rilevato.'
                                    );

                                    replyText =
                                        await handleCameraTrigger(
                                            ws
                                        );
                                }


                                // ==================================================
                                // WAKE WORD SOLA
                                // ==================================================

                                else {

                                    const isOnlyWakeWord =
                                        rawText === 'kairos' ||
                                        rawText === 'ehi kairos' ||
                                        rawText === 'cairos' ||
                                        rawText === 'ehi cairos' ||
                                        rawText === 'ehi' ||
                                        rawText === 'cairo' ||
                                        rawText.length < 5;


                                    if (
                                        isOnlyWakeWord &&
                                        !isSessionActive
                                    ) {

                                        replyText =
                                            'Dimmi pure, Alessandro.';

                                    } else {

                                        // ------------------------------------------------
                                        // CHAT NORMALE
                                        // ------------------------------------------------

                                        ws.conversationHistory.push({
                                            role:
                                                'user',

                                            content:
                                                transcript
                                        });

                                        replyText =
                                            await getGroqChatResponse(
                                                ws.conversationHistory,
                                                ws.userName
                                            );

                                        ws.conversationHistory.push({
                                            role:
                                                'assistant',

                                            content:
                                                replyText
                                        });

                                        // Mantieni gli ultimi 10 messaggi
                                        if (
                                            ws.conversationHistory.length >
                                            10
                                        ) {

                                            ws.conversationHistory =
                                                ws.conversationHistory.slice(
                                                    -10
                                                );
                                        }
                                    }
                                }


                                // ------------------------------------------------
                                // Salva comandi speciali nella cronologia
                                // ------------------------------------------------

                                if (
                                    replyText &&
                                    !ws.conversationHistory.some(
                                        item =>
                                            item.role === 'user' &&
                                            item.content === transcript
                                    )
                                ) {

                                    ws.conversationHistory.push({
                                        role:
                                            'user',

                                        content:
                                            transcript
                                    });

                                    ws.conversationHistory.push({
                                        role:
                                            'assistant',

                                        content:
                                            replyText
                                    });
                                }


                                console.log(
                                    `[Elaborato] ${replyText}`
                                );
                            }


                        } catch (err) {

                            console.error(
                                '[Errore IA]',
                                err
                            );

                            replyText =
                                'Si è verificato un errore di elaborazione.';
                        }


                        // ==================================================
                        // TTS
                        // ==================================================

                        if (!replyText) {
                            return;
                        }

                        console.log(
                            `[TTS] "${replyText}"`
                        );

                        sessionActiveUntil =
                            Date.now() +
                            SESSION_DURATION_MS;

                        await speakText(
                            ws,
                            replyText
                        );

                        sessionActiveUntil =
                            Date.now() +
                            SESSION_DURATION_MS;
                    }


                } catch (e) {

                    console.log(
                        '[WS JSON]',
                        message.toString()
                    );
                }
            }
        );


        // ========================================================
        // DISCONNESSIONE
        // ========================================================

        ws.on(
            'close',
            () => {

                clearInterval(
                    pingInterval
                );

                ws.isSpeaking = false;

                if (
                    activeWsClient === ws
                ) {

                    activeWsClient = null;
                }

                console.log(
                    '[WS] Connessione chiusa.'
                );
            }
        );


        ws.on(
            'error',
            err => {

                console.error(
                    '[WS] Errore:',
                    err.message
                );
            }
        );
    }
);


// ============================================================
// AVVIO SERVER
// ============================================================

server.listen(
    PORT,
    () => {

        console.log(
            `Kairós Brain Server in ascolto sulla porta ${PORT}`
        );

        console.log(
            `WebSocket: ws://localhost:${PORT}/ws`
        );

        console.log(
            `Camera: ${CAMERA_URL}`
        );

        console.log(
            `Volume iniziale: ${currentVolume}%`
        );
    }
);
```
