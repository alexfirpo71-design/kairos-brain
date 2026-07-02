from http.server import BaseHTTPRequestHandler
import edge_tts
import asyncio
import io
import json

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            data = json.loads(post_data.decode('utf-8'))
            text = data.get('text', 'Sistema pronto')
        except:
            text = "Errore nella ricezione testo"
        
        # Generazione audio in memoria
        communicate = edge_tts.Communicate(text, "it-IT-ElsaNeural")
        
        audio_stream = io.BytesIO()
        asyncio.run(self.generate_audio(communicate, audio_stream))
        
        self.send_response(200)
        self.send_header('Content-type', 'audio/mpeg')
        self.end_headers()
        self.wfile.write(audio_stream.getvalue())

    async def generate_audio(self, communicate, stream):
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                stream.write(chunk["data"])

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'text/plain')
        self.end_headers()
        self.wfile.write(b"Kairos TTS Endpoint Attivo")
