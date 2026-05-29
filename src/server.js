const express = require('express');
const cors = require('cors');
require('dotenv').config();
const QRCode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Base de données
const db = new sqlite3.Database('waitlist.db');
db.run(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT,
    restaurantId TEXT,
    position INTEGER,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Client rejoint la liste d'attente
app.post('/join', (req, res) => {
  const { name, phone, restaurantId } = req.body;
  let formattedPhone = phone.trim();
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '+212' + formattedPhone.slice(1);
  }
  db.get('SELECT COUNT(*) as count FROM customers WHERE restaurantId = ?', [restaurantId], (err, row) => {
    const position = row.count + 1;
    db.run('INSERT INTO customers (name, phone, restaurantId, position) VALUES (?, ?, ?, ?)', [name, formattedPhone, restaurantId, position]);
    res.json({ success: true, position, message: `Vous êtes numéro ${position} dans la file` });
  });
});

// Restaurant marque une table comme libre
app.post('/table-free', (req, res) => {
  const { restaurantId } = req.body;
  db.get('SELECT * FROM customers WHERE restaurantId = ? ORDER BY position ASC LIMIT 1', [restaurantId], (err, next) => {
    if (next) {
      db.run('DELETE FROM customers WHERE id = ?', [next.id]);
      const twilio = require('twilio');
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: `whatsapp:${next.phone}`,
        body: `Bonjour ${next.name} ! 🎉 Votre table est prête, vous pouvez entrer maintenant !`
      });
      res.json({ success: true, notified: next });
    } else {
      res.json({ success: false, message: 'Pas de clients en attente' });
    }
  });
});

// Voir la liste d'attente
app.get('/waitlist/:restaurantId', (req, res) => {
  db.all('SELECT * FROM customers WHERE restaurantId = ? ORDER BY position ASC', [req.params.restaurantId], (err, rows) => {
    res.json(rows);
  });
});

// Générer le QR code
app.get('/qrcode/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  const url = `https://waitlist-app-s8lr.onrender.com/?restaurant=${restaurantId}`;
  const qr = await QRCode.toDataURL(url);
  res.send(`<html><body style="text-align:center;padding:40px">
    <h2>QR Code - ${restaurantId}</h2>
    <img src="${qr}" />
    <p>Les clients scannent ce code pour rejoindre la file</p>
  </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));