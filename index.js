import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
    if (req.method === 'POST') {
        const testoDaDire = "Ciao Alessandro, sono Kairós. Il sistema è online.";
        const outputFilename = '/tmp/output.mp3';

        // Generazione audio tramite edge-tts
        exec(`edge-tts --text "${testoDaDire}" --write-media ${outputFilename} --voice it-IT-ElsaNeural`, (error) => {
            if (error) {
                return res.status(500).json({ error: "Errore sintesi vocale" });
            }
            
            // Invio file audio come stream
            const stat = fs.statSync(outputFilename);
            res.writeHead(200, {
                'Content-Type': 'audio/mpeg',
                'Content-Length': stat.size
            });
            
            const readStream = fs.createReadStream(outputFilename);
            readStream.pipe(res);
        });
    } else {
        res.status(200).send("Kairós API Attiva");
    }
}
