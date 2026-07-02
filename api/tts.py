# api/tts.py
from http.server import BaseHTTPRequestHandler
import edge_tts
import asyncio
import json

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        data = json.loads(post_data)
        text = data.get("text", "Ciao, sistema pronto.")
        
        # Generazione audio (Voice: Elsa - IT)
        output_file = "/tmp/output.mp3"
        asyncio.run(edge_tts.Communicate(text, "it-IT-ElsaNeural").save(output_file))
        
        with open(output_file, "rb") as f:
            audio_data = f.read()
            
        self.send_response(200)
        self.send_header('Content-type', 'audio/mpeg')
        self.end_headers()
        self.wfile.write(audio_data)
