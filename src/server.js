const express = require('express');
const cors = require('cors');
require('dotenv').config();
const QRCode = require('qrcode');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT,
      phone TEXT,
      persons INTEGER DEFAULT 1,
      restaurant_id TEXT,
      position INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS persons INTEGER DEFAULT 1`);
  console.log('DB ready');
}
initDB();

app.post('/join', async (req, res) => {
  const { name, phone, persons, restaurantId } = req.body;
  let formattedPhone = phone.trim();
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '+212' + formattedPhone.slice(1);
  }
  const count = await pool.query('SELECT COUNT(*) FROM customers WHERE restaurant_id = $1', [restaurantId]);
  const position = parseInt(count.rows[0].count) + 1;
  await pool.query('INSERT INTO customers (name, phone, persons, restaurant_id, position) VALUES ($1, $2, $3, $4, $5)', [name, formattedPhone, persons || 1, restaurantId, position]);
  res.json({ success: true, position, message: `Vous êtes numéro ${position} dans la file` });
});

app.post('/table-free', async (req, res) => {
  const { restaurantId, customerId } = req.body;
  let next;

  if (customerId) {
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [customerId]);
    next = result.rows[0];
  } else {
    const result = await pool.query('SELECT * FROM customers WHERE restaurant_id = $1 ORDER BY position ASC LIMIT 1', [restaurantId]);
    next = result.rows[0];
  }

  if (next) {
    await pool.query('DELETE FROM customers WHERE id = $1', [next.id]);
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${next.phone}`,
     body: `Bonjour ${next.name} ! 🎉 Votre table est prête, vous pouvez entrer maintenant chez La Boca Negra !\n\n• Vous disposez de 5 minutes pour vous présenter, passé ce délai votre table sera annulée.\n• After 5 minutes no show, your table will be cancelled.\n• Después de 5 minutos sin presentarse, su mesa será cancelada.\n• Na 5 minuten no show zal uw tafel geannuleerd worden.`
    });
    res.json({ success: true, notified: next });
  } else {
    res.json({ success: false, message: 'Pas de clients en attente' });
  }
});

app.get('/waitlist/:restaurantId', async (req, res) => {
  const result = await pool.query('SELECT * FROM customers WHERE restaurant_id = $1 ORDER BY position ASC', [req.params.restaurantId]);
  res.json(result.rows);
});

app.get('/qrcode/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  const url = `https://waitlist-app-s8lr.onrender.com/?restaurant=${restaurantId}`;
  const qr = await QRCode.toDataURL(url);
  res.send(`<html><body style="text-align:center;padding:40px;background:#000">
    <h2 style="color:white;font-family:serif">QR Code — La Boca Negra</h2>
    <img src="${qr}" style="margin-top:20px" />
    <p style="color:rgba(255,255,255,0.5);margin-top:16px;font-family:sans-serif">Les clients scannent ce code pour rejoindre la file</p>
  </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));