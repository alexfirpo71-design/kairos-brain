const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Funzione per la chat testuale con Groq
async function getGroqChatResponse(messages) {
    try {
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile', // Sostituisci con 'llama-3.1-8b-instant' se vuoi più velocità
                messages: messages,
                max_tokens: 4000,
                temperature: 0.7
            })
        });

        if (!groqResponse.ok) {
            const errData = await groqResponse.text();
            throw new Error(`Errore API Groq: ${groqResponse.status} - ${errData}`);
        }

        const data = await groqResponse.json();
        return data.choices[0]?.message?.content || '';

    } catch (error) {
        console.error('Errore in getGroqChatResponse:', error);
        throw error;
    }
}

// Funzione per la gestione delle immagini (OCR / Vision) con Groq
async function handleImageUpload(req, res) {
    try {
        const { imageBuffer, promptText } = req.body; 
        const base64Image = typeof imageBuffer === 'string' ? imageBuffer : Buffer.from(imageBuffer).toString('base64');

        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.2-11b-vision-preview', // OBBLIGATORIO per leggere l'immagine
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: promptText || 'Analizza questa immagine e leggi il testo presente.'
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1024,
                temperature: 0.1
            })
        });

        if (!groqResponse.ok) {
            const errData = await groqResponse.text();
            throw new Error(`Errore API Groq: ${groqResponse.status} - ${errData}`);
        }

        const data = await groqResponse.json();
        const extractedText = data.choices[0]?.message?.content || '';

        res.json({ success: true, text: extractedText });

    } catch (error) {
        console.error('Errore in handleImageUpload:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

// Endpoint HTTP
app.post('/api/vision', handleImageUpload);

app.post('/api/chat', async (req, res) => {
    try {
        const { messages } = req.body;
        const responseText = await getGroqChatResponse(messages);
        res.json({ success: true, response: responseText });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Gestione WebSocket per la connessione ESP32 / Hardware
wss.on('connection', (ws) => {
    console.log('Dispositivo hardware connesso via WebSocket');

    ws.on('message', async (message) => {
        try {
            console.log('Messaggio ricevuto da hardware:', message.toString());
        } catch (error) {
            console.error('Errore nella gestione del messaggio WebSocket:', error);
        }
    });

    ws.on('close', () => {
        console.log('Dispositivo hardware disconnesso');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server Kairós in ascolto sulla porta ${PORT}`);
});
