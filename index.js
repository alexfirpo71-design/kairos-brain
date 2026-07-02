export default function handler(req, res) {
  res.status(200).json({ 
    message: "Ricevuto", 
    method: req.method,
    length: req.headers['content-length'] 
  });
}
