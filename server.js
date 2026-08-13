import http, { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { spawn } from 'child_process';

lascia activeWsClient = null;

const server = createServer(async (req, res) => {
Â Â se (req.method === 'POST' && req.url === '/upload') {
Â Â Â Â lascia buffer = [];
Â Â Â Â req.on('data', chunk => buffers.push(chunk));
Â Â Â Â req.on('end', async () => {
Â Â Â Â Â Â const imageBuffer = Buffer.concat(buffers);
Â Â Â Â Â Â prova {
Â Â Â Â Â Â Â Â se (!imageBuffer || imageBuffer.length === 0) {
Â Â Â Â Â Â Â Â Â Â res.writeHead(400, { 'Content-Type': 'text/plain' });
Â Â Â Â Â Â Â Â Â Â Â res.end('Immagine vuota o non ricevuta.');
ritorno;
Â Â Â Â Â Â Â Â }

console.log("[Server] Immagine ricevuta dall'ESP32 tramite POST, elaborazione in corso...");
Â Â Â Â Â Â Â Â const apiKey = process.env.GROW_API_KEY;
Â Â Â Â Â Â Â Â Â 
Â Â Â Â Â Â Â Â const visionResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
Â Â Â Â Â Â Â Â Â Â metodo: 'POST',
Â Â Â Â Â Â Â Â Â Â headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
Â Â Â Â Â Â Â Â Â Â corpo: JSON.stringify({
modello: 'qwen/qwen3.6-27b',
Â Â Â Â Â Â Â Â Â Â Â Â messaggi: [
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â {
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â ruolo: 'sistema',
contenuto: 'Sei Kairòs, l assistente di Alessandro. Osserva l'immagine e scrivi UNICA E ESCLUSIVAMENTE la frase di risposta finale in italiano, descrivendo il testo sul foglietto e ciò che c'è intorno. NON inserire passaggi intermedi, elenchi numerati, analisi, tag di pensiero o markdown di alcun tipo. Fornisci solo il testo secco da leggere a voce.'
Â Â Â Â Â Â Â Â Â Â Â Â Â Â },
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â {
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â ruolo: 'utente',
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â contenuto: [
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â { type: 'text', text: 'Trascrivi il testo sul foglietto e descrivi cosa c'è intorno. Rispondi solo con la frase finale." },
{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` } }
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â ]
Â Â Â Â Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â Â Â Â Â],
Â Â Â Â Â Â Â Â Â Â Â Â Â max_tokens: 200,
Temperatura: 0,1
Â Â Â Â Â Â Â Â Â Â })
Â Â Â Â Â Â Â Â });

Â Â Â Â Â Â Â Â se (!visionResponse.ok) {
const errorBody = attendono visionResponse.text();
Â Â Â Â Â Â Â Â Â Â console.error(`[Errore Dettagliato Groq] Stato: ${visionResponse.status} - Corpo: ${errorBody}`);
Â Â Â Â Â Â Â Â Â Â lancia un nuovo errore(`Errore API: ${visionResponse.status}`);
Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â 
Â Â Â Â Â Â Â Â const visionData = await visionResponse.json();
Â Â Â Â Â Â Â Â let rawText = visionData.choices[0].message.content.trim();
Â Â Â Â Â Â Â Â Â 
Â Â Â Â Â Â Â Â let resultText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

Â Â Â Â Â Â Â Â // Estrae solo la parte finale pulita se il modello include passaggi numerati o bozze
Â Â Â Â Â Â Â Â se (resultText.include("4.")) {
Â Â Â Â Â Â Â Â Â Â const parts = resultText.split(/4\.\s*\*\*.*?\*\*:/i);
Â Â Â Â Â Â Â Â Â Â se (parti.lunghezza > 1) {
Â Â Â Â Â Â Â Â Â Â Â Â Â resultText = parts[1].trim().replace(/^["']|["']$/g, '');
Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â // Fallimento di sicurezza alternativo se trova virgolette o sezioni di draft
Â Â Â Â Â Â Â Â se (resultText.include("Scrivi la bozza della risposta")) {
Â Â Â Â Â Â Â Â Â Â const match = resultText.match(/["']([^"']+)["']/g);
Â Â Â Â Â Â Â Â Â Â se (corrispondenza e corrispondenza.lunghezza > 0) {
Â Â Â Â Â Â Â Â Â Â Â Â Â resultText = match[match.length - 1].replace(/["']/g, '');
Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â 
console.log(`[Risposta Monitor] "${resultText}"`);
Â Â Â Â Â Â Â Â Â 
Â Â Â Â Â Â Â Â res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
Â Â Â Â Â Â Â Â Â res.end(`Immagine ricevuta ed elaborata con successo: ${resultText}`);

Â Â Â Â Â Â Â Â se (activeWsClient && activeWsClient.readyState === activeWsClient.OPEN) {
console.log("[WS] Invio audio della descrizione dello scatto all'ESP32...");
activeWsClient.isSpeaking = true;
activeWsClient.send(JSON.stringify({ action: 'speak', text: resultText.trim() }));

Â Â Â Â Â Â Â Â Â Â prova {
Â Â Â Â Â Â Â Â Â Â Â Â const textChunks = splitTextIntoChunks(resultText, 150);
Â Â Â Â Â Â Â Â Â Â Â Â Â Â 
Â Â Â Â Â Â Â Â Â Â Â Â Â for (lascia pezzo di testoChunks) {
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â se (activeWsClient.readyState !== activeWsClient.OPEN || !activeWsClient.isSpeaking) interrompi;
Â Â Â Â Â Â Â Â Â Â Â Â Â Â const pcmPart = attendono getSingleTtsPcm(chunk, currentVolume);
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â 
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â se (pcmPart && pcmPart.length > 0) {
const dimensione pezzo = 4096;
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â per (lascia i = 0; i < pcmPart.length; i += chunkSize) {
Â
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â 
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â while (activeWsClient.bufferedAmount > 65536) {
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â attendono nuova Promessa(resolve => setTimeout(resolve, 20));
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â if (activeWsClient.readyState !== activeWsClient.OPEN || !activeWsClient.isSpeaking) break;
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â 
activeWsClient.send(pcmPart.subarray(i, i + Math.min(chunkSize, pcmPart.length - i)), { binary: true });
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â Â Â Â Â Â // Pausa per evitare il blocco di Google TTS
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â await new Promise(resolve => setTimeout(resolve, 300));
Â Â Â Â Â Â Â Â Â Â Â Â }

Â Â Â Â Â Â Â Â Â Â Â Â Â se (activeWsClient.isSpeaking) {
console.log("[WS] Streaming audio dello scatto completato.");
Â Â Â Â Â Â Â Â Â Â Â Â Â Â if (activeWsClient.readyState === activeWsClient.OPEN) {
activeWsClient.send(JSON.stringify({ action: 'stop' }));
Â Â Â Â Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â Â Â Â }
activeWsClient.isSpeaking = false;
Â Â Â Â Â Â Â Â Â Â } catch (streamErr) {
console.error("[Errore streaming audio scatto]", streamErr);
Â Â Â Â Â Â Â Â Â Â Â Â Â se (activeWsClient) activeWsClient.isSpeaking = false;
Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â }

Â Â Â Â Â Â } catch (err) {
console.error("[Errore caricamento]", err.message);
Â Â Â Â Â Â Â Â res.writeHead(500, { 'Content-Type': 'text/plain' });
Â Â Â Â Â Â Â Â Â res.end('Errore interno del server durante l'elaborazione dell'immagine.');
Â Â Â Â Â Â }
Â Â Â Â });
Â Â } altrimenti {
Â Â Â Â res.writeHead(200, { 'Content-Type': 'text/plain' });
Â Â Â Â res.end('Kairos Brain Server è in esecuzione!\n');
Â Â }
});

const wss = new WebSocketServer({ server, path: '/ws' });

const sessionHistories = new Map();
lascia currentVolume = 70;

funzione formatTimeForSpeech(testo) {
Â Â restituisce text.replace(/\b([0-2]?[0-9])[:\.]([0-5][0-9])\b/g, (match, hours, minutes) => {
Â Â Â Â const h = parseInt(ore, 10);
Â Â Â Â const m = parseInt(minuti, 10);
Â Â Â Â Â 
Â Â Â Â lascia testoora = h === 1 ? "l'una" : `le ${h}`;
Â Â Â Â se (h === 0) hourText = "le ore zero";
Â Â Â Â Â 
Â Â Â Â se (m === 0) restituisci `${hourText} in punto`;
Â Â Â Â se (m < 10) restituisci `${hourText} e zero ${m}`;
Â Â Â Â restituisce `${hourText} e ${m}`;
Â Â });
}

funzione splitTextIntoChunks(testo, lunghezza massima = 250) {
Â Â se (lunghezza testo <= lunghezza massima) restituisci [testo];
Â Â const sentences = text.match(/[^.!?]+[.!?]+["']?|.+$/g) || [text];
Â Â lascia chunks = [];
Â Â lascia currentChunk = "";

Â Â per (sia frase di frasi) {
Â Â Â Â se ((currentChunk + sentence).length <= maxLength) {
Â Â Â Â Â Â currentChunk += sentence;
Â Â Â Â } altrimenti {
Â Â Â Â Â Â se (currentChunk) chunks.push(currentChunk.trim());
Â Â Â Â Â Â se (lunghezza frase > lunghezza massima) {
Â Â Â Â Â Â Â Â let words = sentence.split(" ");
Â Â Â Â Â Â Â Â lascia subChunk = "";
Â Â Â Â Â Â Â per (sia parola di parole) {
Â Â Â Â Â Â Â Â Â Â se ((subChunk + " " + word).length <= maxLength) {
Â Â Â Â Â Â Â Â Â Â Â Â subChunk += (subChunk ? " " : "") + parola;
Â Â Â Â Â Â Â Â Â Â } altro {
Â Â Â Â Â Â Â Â Â Â Â Â Â se (subChunk) chunks.push(subChunk.trim());
Â Â Â Â Â Â Â Â Â Â Â Â subChunk = parola;
Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â currentChunk = subChunk;
Â Â Â Â Â Â } altrimenti {
Â Â Â Â Â Â Â Â currentChunk = frase;
Â Â Â Â Â Â }
Â Â Â Â }
Â Â }
Â Â se (currentChunk) chunks.push(currentChunk.trim());
restituisci blocchi;
}

funzione asincrona getSingleTtsPcm(textChunk, volumePercent) {
prova {
Â Â Â Â const timeFormatted = formatTimeForSpeech(textChunk);

Â Â Â Â const speechFriendlyText = timeFormatched
Â Â Â Â Â Â .replace(/Kairós|Kairos|Kairós/gi, 'Cairos');

Â Â Â Â const sanitizedText = speechFriendlyText
Â Â Â Â Â Â .replace(/[^\w\sÃ Ã¨Ã©Ã¬Ã²Ã¹Ã€ÃˆÃ‰ÃŒÃ'Ã™.,?!]/g, '')
Â Â Â Â Â Â .trim();

Â Â Â Â const cleanText = encodeURIComponent(sanitizedText);
Â Â Â Â const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${cleanText}&tl=it&client=tw-ob`;
Â Â Â Â Â 
Â Â Â Â const response = await fetch(ttsUrl, {
Â Â Â Â Â headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
Â Â Â Â });

Â Â Â Â se (!risposta.ok) {
Â Â Â Â Â Â console.error(`[Errore TTS] Stato ${response.status} per: "${sanitizedText}"`);
Â Â Â Â Â Â throw new Error(`Errore TTS HTTP: ${response.status}`);
Â Â Â Â }
Â Â Â Â Â 
Â Â Â Â const arrayBuffer = await response.arrayBuffer();
Â Â Â Â const mp3Buffer = Buffer.from(arrayBuffer);

Â Â Â Â const volumeFactor = Math.max(0.05, volumePercent / 70);

Â Â Â Â const pcmBuffer = await new Promise((resolve, reject) => {
const ffmpeg = spawn('ffmpeg', [
Â Â Â Â Â Â Â '-i', 'pipe:0',
Â Â Â Â Â Â Â '-af', `volume=${volumeFactor},equalizer=f=300:width_type=o:width=2:g=2,acompressor=threshold=-20dB:ratio=2:attack=5:release=50`,
Â Â Â Â Â Â Â '-f', 's16le',
Â Â Â Â Â Â Â Â Â '-acodec', 'pcm_s16le',
Â Â Â Â Â Â Â Â '-ac', '1',
Â Â Â Â Â Â Â Â '-ar', '16000',
Â Â Â Â Â Â Â 'pipe:1'
Â Â Â Â Â Â ]);

lascia pezzi = [];
Â Â Â Â Â ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
Â Â Â Â Â Â ffmpeg.on('close', code => {
Â Â Â Â Â Â Â Â if (codice === 0) risolvere(Buffer.concat(chunk));
Â Â Â Â Â Â Â altrimenti rifiuta(nuovo Errore(`FFmpeg è terminato con codice ${code}`));
Â Â Â Â Â Â });
Â Â Â Â Â ffmpeg.on('error', err => reject(err));

Â Â Â Â Â Â ffmpeg.stdin.write(mp3Buffer);
ffmpeg.stdin.end();
Â Â Â Â });

Â Â Â Â const silenceSamples = 4000; 
Â Â Â Â let paddedPcmBuffer = Buffer.concat([pcmBuffer, Buffer.alloc(silenceSamples * 2)]);

Â Â Â Â const fadeSamplesIn = Math.min(120, imbottitoPcmBuffer.length / 2);
Â Â Â Â for (let i = 0; i < fadeSamplesIn; i++) {
Â Â Â Â Â Â const sample = paddedPcmBuffer.readInt16LE(i * 2);
Â Â Â Â Â Â const moltiplicatore = i / fadeSamplesIn;
Â Â Â Â Â Â paddedPcmBuffer.writeInt16LE(Math.floor(sample * multiplier), i * 2);
Â Â Â Â }

Â Â Â Â const fadeSamplesOut = silenzioSamples;
Â Â Â Â const startOutIdx = (paddedPcmBuffer.length / 2) - fadeSamplesOut;
Â Â Â Â per (lascia i = 0; i < fadeSamplesOut; i++) {
const idx = (startOutIdx + i) * 2;
Â Â Â Â Â Â const sample = paddedPcmBuffer.readInt16LE(idx);
moltiplicatore const = (fadeSamplesOut - i) / fadeSamplesOut;
Â Â Â Â Â Â paddedPcmBuffer.writeInt16LE(Math.floor(sample * multiplier), idx);
Â Â Â Â }

Â Â Â Â restituisce paddedPcmBuffer;
Â Â } catch (err) {
console.error("[Errore TTS Singolo]", err.message);
Â Â Â Â restituisce null;
Â Â }
}

funzione asincrona transcribeAudio(audioBuffer) {
Â Â const apiKey = process.env.GROQ_API_KEY;
Â Â if (!apiKey) throw new Error("GROQ_API_KEY mancante.");

Â Â const dataLength = audioBuffer.length;
Â Â const fileLength = dataLength + 36;
Â Â const header = Buffer.from([
Â Â Â Â 0x52, 0x49, 0x46, 0x46,
Â Â Â Â fileLength & 0xff, (fileLength >> 8) & 0xff, (fileLength >> 16) & 0xff, (fileLength >> 24) & 0xff,
Â Â Â Â 0x57, 0x41, 0x56, 0x45,
Â Â Â Â 0x66, 0x6d, 0x74, 0x20,
Â Â Â Â 16, 0, 0, 0,Â Â Â Â Â 
Â Â Â Â 1, 0,Â Â Â Â Â Â Â Â 
Â Â Â Â 1, 0,Â Â Â Â Â Â Â Â 
Â Â Â Â 16000 e 0xff, (16000 >> 8) e 0xff, (16000 >> 16) e 0xff, (16000 >> 24) e 0xff,
Â Â Â Â 32000 e 0xff, (32000 >> 8) e 0xff, (32000 >> 16) e 0xff, (32000 >> 24) e 0xff,
Â Â Â Â 2, 0,Â Â Â Â Â Â Â Â 
Â Â Â Â 16, 0,Â Â Â Â Â Â Â Â Â 
Â Â Â Â 0x64, 0x61, 0x74, 0x61,
Â Â Â Â dataLength & 0xff, (dataLength >> 8) & 0xff, (dataLength >> 16) & 0xff, (dataLength >> 24) & 0xff
Â Â ]);
const wavBuffer = Buffer.concat([header, audioBuffer]);

Â Â const formData = new FormData();
formData.append('file', wavBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
formData.append('model', 'whisper-large-v3');
formData.append('language', 'it');

Â Â const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
Â Â Â Â metodo: 'POST',
Â Â Â Â headers: { 'Authorization': `Bearer ${apiKey}`, ...formData.getHeaders() },
corpo: formData
Â Â });

Â Â se (!response.ok) lancia un nuovo Error(`Errore Whisper: ${response.status}`);
const data = await response.json();
restituisci dati.testo;
}

funzione asincrona getGroqChatResponse(conversationHistory, userName = "Alessandro") {
Â Â const apiKey = process.env.GROQ_API_KEY;
Â Â const systemPrompt = `Kairós, l'assistente IA avanzato di ${userName}.Â 
Parli sempre in italiano in modo diretto, deciso ma senza eccessive lungaggini e solo quando viene richiesto.
CONTESTO PRIVATO (da usare ESCLUSIVAMENTE se l'utente ti fa domande dirette in merito, non menzionarlo mai di tua spontanea volontà):
- L'utente ha 55 anni e si chiama Alessandro, è un perito elettronico a Genova.
- Famiglia e affetti: la figlia Margot, la fidanzata Tiziana, papà Lino, mamma Elviana mancata il 24 dicembre 2024, i gatti Lulù, il coniglio Isalide, il cane Miele, e la gatta Prugna mancata l'11 maggio 2026.
- Passioni tecniche: retrogaming, simulazione di volo, pilota di drone.`;

const messages = [{ role: 'system', content: systemPrompt }, ...conversationHistory];

Â Â const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
Â Â Â Â metodo: 'POST',
Â Â Â Â headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
corpo: JSON.stringify({
modello: 'llama-3.1-8b-instant',
Â Â Â Â Â messaggi: messaggi,
Â Â Â Â Â Â max_tokens: 300,
temperatura: 0,7
Â Â Â Â })
Â Â });

Â Â se (!risposta.ok) {
Â Â Â Â se (response.status === 429) {
Â Â Â Â Â Â Â launch new Error("Troppe richieste in corso. Attendi qualche secondo.");
Â Â Â Â }
Â Â Â Â throw new Error(`Errore chat: ${response.status}`);
Â Â }
const data = await response.json();
Â Â restituisce data.choices[0].message.content;
}

wss.on('connection', (ws, req) => {
Â Â console.log(`[WS] Connessi da: ${req.socket.remoteAddress}`);
activeWsClient = ws;
ws.userName = "Alessandro";
ws.conversationHistory = [];
ws.isSpeaking = false;
Â Â lascia audioBuffer = [];

Â Â lascia sessionActiveUntil = 0;
Â Â const SESSION_DURATION_MS = 20000;

ws.isAlive = true;
ws.on('pong', () => { ws.isAlive = true; });

Â Â const pingInterval = setInterval(() => {
Â Â Â Â se (ws.isAlive === false) {
clearInterval(pingInterval);
Â Â Â Â Â Â return ws.terminate();
Â Â Â Â }
ws.isAlive = false;
ws.ping();
Â Â }, 30000);

ws.on('message', async (message, isBinary) => {
Â Â Â Â se (è binario) {
Â Â Â Â Â Â se (ws.isSpeaking) restituisci;
Â Â Â Â Â Â audioBuffer.push(messaggio);
Â Â Â Â } altrimenti {
Â Â Â Â Â Â prova {
Â Â Â Â Â Â Â Â const data = JSON.parse(message.toString());
Â Â Â Â Â Â Â Â Â 
Â Â Â Â Â Â Â Â se (data.action === 'stop') {
console.log("[WS] Comando di stop ricevuto dall'ESP32.");
ws.isSpeaking = false;
Â Â Â Â Â Â Â Â Â Â audioBuffer = [];
ritorno;
Â Â Â Â Â Â Â Â }

Â Â Â Â Â Â Â Â se (data.user) ws.userName = data.user;

Â Â Â Â Â Â Â Â se (data.mac) {
ws.mac = data.mac;
Â Â Â Â Â Â Â Â Â Â se (!sessionHistories.has(data.mac)) {
Â Â Â Â Â Â Â Â Â Â Â Â sessionHistories.set(data.mac, []);
Â Â Â Â Â Â Â Â Â Â }
ws.conversationHistory = sessionHistories.get(data.mac);
Â Â Â Â Â Â Â Â }

Â Â Â Â Â Â Â Â se (data.mac || data.device || data.user || data.location || data.status) {
ritorno;
Â Â Â Â Â Â Â Â }

Â Â Â Â Â Â Â Â se (data.state === 'processing') {
Â Â Â Â Â Â Â Â Â Â const completeAudioBuffer = Buffer.concat(audioBuffer);
Â Â Â Â Â Â Â Â Â Â audioBuffer = [];

Â Â Â Â Â Â Â Â Â Â lascia che il testo della risposta = null;Â 
Â Â Â Â Â Â Â Â Â Â prova {
Â Â Â Â Â Â Â Â Â Â Â Â const transcript = await transcribeAudio(completeAudioBuffer);
Â Â Â Â Â Â Â Â Â Â Â Â Â Â console.log(`[Whisper] Trascritto: "${transcript}"`);
Â Â Â Â Â Â Â Â Â Â Â Â Â Â 
Â Â Â Â Â Â Â Â Â Â Â Â se (transcript && transcript.trim().length > 0) {
Â Â Â Â Â Â Â Â Â Â Â Â Â Â const rawText = transcript.toLowerCase().replace(/[.,\/$%\^&\*;:{}=\-_`~()?]/g, "").trim();
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â const now = Date.now();

Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â const isSessionActive = now < sessionActiveUntil;

Â Â Â Â Â Â Â Â Â Â Â Â Â Â const hasWakeWord = rawText.includes('kairos') || rawText.includes('cairos') || rawText.includes('cairo') || rawText.includes('ehi');

Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â se (!isSessionActive && !hasWakeWord) {
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â console.log(`[Ignorato] Rumore di fondo o parlato estraneo: "${transcript}"`);
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â ritorno; 
Â Â Â Â Â Â Â Â Â Â Â Â Â Â }

Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â sessionActiveUntil = now + SESSION_DURATION_MS;

Â Â Â Â Â Â Â Â Â Â Â Â Â Â if (rawText.includes('stop') || rawText.includes('fermati') || rawText.includes('basta') || rawText.includes('silenzio')) {
ws.isSpeaking = false;
ws.send(JSON.stringify({ action: 'stop' }));
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â console.log("[Comando] Interruzione eseguita.");
sessionActiveUntil = 0;Â 
ritorno;
Â Â Â Â Â Â Â Â Â Â Â Â Â Â }

Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â if (rawText.includes('alza') || rawText.includes('più alto') || rawText.includes('volume su')) {
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â currentVolume = Math.min(100, currentVolume + 15);
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â rispostaTesto = `Volume al ${currentVolume} per cento.`;
ws.conversationHistory.push({ role: 'user', content: transcript });
ws.conversationHistory.push({ ruolo: 'assistente', contenuto: rispostaTesto });
Â Â Â Â Â Â Â Â Â Â Â Â Â Â }Â 
Â Â Â Â Â Â Â Â Â Â Â Â Â Â else if (rawText.includes('abbassa') || rawText.includes('più basso') || rawText.includes('volume giu')) {
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â currentVolume = Math.max(10, currentVolume - 15);
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â rispostaTesto = `Volume al ${currentVolume} per cento.`;
ws.conversationHistory.push({ role: 'user', content: transcript });
ws.conversationHistory.push({ ruolo: 'assistente', contenuto: rispostaTesto });
Â Â Â Â Â Â Â Â Â Â Â Â Â Â }Â 
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â else if (rawText.includes('telecamera') || rawText.includes('guarda') || rawText.includes('inquadra') || rawText.includes('biglietto')) {
console.log("[WS] Intenzione telecamera rilevata. Invio comando di scatto all'ESP32...");
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â 
ws.send(JSON.stringify({ action: 'trigger_camera', text: 'Scatto la foto...' }));

Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â rispostaTesto = "Un attimo, guardo subito.";
ws.conversationHistory.push({ role: 'user', content: transcript });
ws.conversationHistory.push({ ruolo: 'assistente', contenuto: rispostaTesto });
Â Â Â Â Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â altro {
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â const isOnlyWakeWord = rawText === 'kairos' || testogrezzo === 'ehi kairos' || testogrezzo === 'cairos' || testo grezzo === 'ehi cairos' || testogrezzo === 'ehi' || testogrezzo === 'cairo' || testoraw.lunghezza < 5;

Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â se (isOnlyWakeWord && !isSessionActive) {
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â rispostaTesto = "Dimmi puro, Alessandro.";
ws.conversationHistory.push({ role: 'user', content: transcript });
ws.conversationHistory.push({ ruolo: 'assistente', contenuto: rispostaTesto });
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â } else {
ws.conversationHistory.push({ role: 'user', content: transcript });
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â rispostaTesto = attendono getGroqChatResponse(ws.conversationHistory, ws.userName);
ws.conversationHistory.push({ ruolo: 'assistente', contenuto: rispostaTesto });

Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â se (ws.conversationHistory.length > 10) {
ws.conversationHistory = ws.conversationHistory.slice(-10);
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â Â Â Â Â Â }

Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â console.log(`[Elaborato] Risposta: "${replyText}" | Volume: ${currentVolume}%`);
Â Â Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â Â } catch (err) {
console.error("[Errore IA]", err);
Â Â Â Â Â Â Â Â Â Â Â Â Â AnswerText = "Si è verificato un errore di elaborazione.";
Â Â Â Â Â Â Â Â Â Â }

Â Â Â Â Â Â Â Â Â Â if (!replyText) return;

ws.isSpeaking = true;
ws.send(JSON.stringify({ action: 'speak', text: AnswerText.trim() }));

Â Â Â Â Â Â Â Â Â Â sessionActiveUntil = Date.now() + SESSION_DURATION_MS;

Â Â Â Â Â Â Â Â Â Â prova {
const textChunks = splitTextIntoChunks(replyText, 150);
Â Â Â Â Â Â Â Â Â Â Â Â Â Â 
Â Â Â Â Â Â Â Â Â Â Â Â Â for (lascia pezzo di testoChunks) {
Â Â Â Â Â Â Â Â Â Â Â Â Â Â if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
Â Â Â Â Â Â Â Â Â Â Â Â Â Â const pcmPart = attendono getSingleTtsPcm(chunk, currentVolume);
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â 
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â se (pcmPart && pcmPart.length > 0) {
const dimensione pezzo = 4096;
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â per (lascia i = 0; i < pcmPart.length; i += chunkSize) {
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â 
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â while (ws.bufferedAmount > 65536) {
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â attendono nuova Promessa(resolve => setTimeout(resolve, 20));
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â if (ws.readyState !== ws.OPEN || !ws.isSpeaking) break;
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â 
ws.send(pcmPart.subarray(i, i + Math.min(chunkSize, pcmPart.length - i)), { binary: true });
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â Â Â Â Â Â // Pausa per evitare il blocco di Google TTS
Â Â Â Â Â Â Â Â Â Â Â Â Â Â Â await new Promise(resolve => setTimeout(resolve, 300));
Â Â Â Â Â Â Â Â Â Â Â Â }

Â Â Â Â Â Â Â Â Â Â Â Â se (ws.isSpeaking) {
console.log("[WS] Streaming audio completato.");
Â Â Â Â Â Â Â Â Â Â Â Â Â Â if (ws.readyState === ws.OPEN) {
ws.send(JSON.stringify({ action: 'stop' }));
Â Â Â Â Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â Â Â Â Â }
ws.isSpeaking = false;
Â Â Â Â Â Â Â Â Â Â Â Â Â Â 
Â Â Â Â Â Â Â Â Â Â Â Â sessionActiveUntil = Date.now() + SESSION_DURATION_MS;

Â Â Â Â Â Â Â Â Â Â } catch (streamErr) {
console.error("[Errore streaming audio]", streamErr);
ws.isSpeaking = false;
Â Â Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â Â Â }
Â Â Â Â Â Â } catch (e) {
console.log('[WS Testo]', message.toString());
Â Â Â Â Â Â }
Â Â Â Â }
Â Â });

Â Â ws.on('close', () => {
clearInterval(pingInterval);
ws.isSpeaking = false;
Â Â Â Â se (activeWsClient === ws) activeWsClient = null;
console.log("[WS] Connessione chiusa.");
Â Â });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
Â Â console.log(`Server Kairòs in ascolto sulla porta ${PORT}`);
});
