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
      status TEXT DEFAULT 'waiting',
      notified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS persons INTEGER DEFAULT 1`);
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'waiting'`);
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP`);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS served_log (
      id SERIAL PRIMARY KEY,
      restaurant_id TEXT,
      persons INTEGER,
      served_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('DB ready');
}
initDB();

app.post('/join', async (req, res) => {
  const { name, phone, persons, restaurantId } = req.body;
  let formattedPhone = phone.trim();
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '+212' + formattedPhone.slice(1);
  }
  const count = await pool.query('SELECT COUNT(*) FROM customers WHERE restaurant_id = $1 AND status = $2', [restaurantId, 'waiting']);
  const position = parseInt(count.rows[0].count) + 1;
  await pool.query('INSERT INTO customers (name, phone, persons, restaurant_id, position, status) VALUES ($1, $2, $3, $4, $5, $6)', [name, formattedPhone, persons || 1, restaurantId, position, 'waiting']);
  res.json({ success: true, position, message: `Vous êtes numéro ${position} dans la file` });
});

// Notifier le client — SMS via Twilio
app.post('/table-free', async (req, res) => {
  const { restaurantId, customerId } = req.body;
  let next;

  if (customerId) {
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [customerId]);
    next = result.rows[0];
  } else {
    const result = await pool.query('SELECT * FROM customers WHERE restaurant_id = $1 AND status = $2 ORDER BY position ASC LIMIT 1', [restaurantId, 'waiting']);
    next = result.rows[0];
  }

  if (next) {
    await pool.query('UPDATE customers SET status = $1, notified_at = NOW() WHERE id = $2', ['notified', next.id]);
    
    try {
      const twilio = require('twilio');
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        from: process.env.TWILIO_SMS_FROM,
        to: next.phone,
        body: `Bonjour ${next.name} ! Votre table est prete chez La Boca Negra ! Vous avez 5 minutes pour vous presenter. / Your table is ready! You have 5 minutes. / Su mesa esta lista! Tiene 5 minutos.`
      });
      res.json({ success: true, notified: next });
    } catch (err) {
      console.error('SMS error:', err.message);
      res.json({ success: true, notified: next, sms_error: err.message });
    }

  } else {
    res.json({ success: false, message: 'Pas de clients en attente' });
  }
});

// Confirmer l'entrée du client
app.post('/confirm', async (req, res) => {
  const { customerId } = req.body;
  const result = await pool.query('SELECT * FROM customers WHERE id = $1', [customerId]);
  const customer = result.rows[0];
  if (customer) {
    await pool.query('DELETE FROM customers WHERE id = $1', [customerId]);
    await pool.query('INSERT INTO served_log (restaurant_id, persons) VALUES ($1, $2)', [customer.restaurant_id, customer.persons || 1]);
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// Annuler un client (no show)
app.post('/cancel', async (req, res) => {
  const { customerId } = req.body;
  await pool.query('DELETE FROM customers WHERE id = $1', [customerId]);
  res.json({ success: true });
});

app.get('/waitlist/:restaurantId', async (req, res) => {
  const result = await pool.query('SELECT * FROM customers WHERE restaurant_id = $1 ORDER BY position ASC', [req.params.restaurantId]);
  res.json(result.rows);
});

// Stats du jour
app.get('/stats/:restaurantId', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const result = await pool.query(
    `SELECT COUNT(*) as total_clients, COALESCE(SUM(persons), 0) as total_persons 
     FROM served_log 
     WHERE restaurant_id = $1 AND DATE(served_at) = $2`,
    [req.params.restaurantId, today]
  );
  res.json(result.rows[0]);
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