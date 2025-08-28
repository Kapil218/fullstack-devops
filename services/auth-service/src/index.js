require('dotenv').config();
const cookieParser = require('cookie-parser');
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

// CORS setup (allow cookies from frontend)
app.use(cors({
  origin: process.env.FRONTEND_URL, // e.g., http://localhost
  credentials: true, // allow cookies
}));
app.use(express.json());
app.use(cookieParser());

const pool = new Pool({
  connectionString: process.env.AUTH_DB_URL,
});

// --- Health check ---
app.get('/health', (req, res) => res.send('ok'));

// --- Get all users (protected) ---
app.get('/users', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, email, created_at FROM users');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// --- Register ---
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Username, email, and password required' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users(username, email, password) VALUES($1, $2, $3) RETURNING id, username, email',
      [username, email, hashedPassword]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(400).json({ error: 'Username or email already exists' });
    res.status(500).send('Server error');
  }
});

// --- Login ---
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    const user = rows[0];
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });

    const accessToken = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = crypto.randomBytes(64).toString('hex');
    const refreshTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      'UPDATE users SET refresh_token=$1, refresh_token_expires=$2 WHERE id=$3',
      [refreshToken, refreshTokenExpiry, user.id]
    );

    // Set cookies
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 15 * 60 * 1000, // 15 min
      path: "/",
    });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/",
    });

    res.status(200).json({ message: "Logged in" });

  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// --- Refresh access token ---
app.post('/refresh-token', async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) return res.status(401).json({ message: 'No refresh token provided' });

    const { rows } = await pool.query('SELECT * FROM users WHERE refresh_token=$1', [refreshToken]);
    const user = rows[0];
    if (!user) return res.status(401).json({ message: 'Invalid refresh token' });

    if (new Date() > new Date(user.refresh_token_expires))
      return res.status(401).json({ message: 'Refresh token expired' });

    const accessToken = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    // Rotate refresh token
    const newRefreshToken = crypto.randomBytes(64).toString('hex');
    const refreshTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      'UPDATE users SET refresh_token=$1, refresh_token_expires=$2 WHERE id=$3',
      [newRefreshToken, refreshTokenExpiry, user.id]
    );

    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 15 * 60 * 1000,
      path: "/",
    });
    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.status(200).json({ message: "Tokens refreshed" });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// --- Logout ---
app.post('/logout', async (req, res) => {
  const refreshToken = req.body.refreshToken || req.cookies.refreshToken;
  if (!refreshToken) return res.status(400).json({ message: 'Refresh token required' });

  try {
    await pool.query(
      'UPDATE users SET refresh_token=NULL, refresh_token_expires=NULL WHERE refresh_token=$1',
      [refreshToken]
    );

    res.clearCookie('accessToken', { path: '/' });
    res.clearCookie('refreshToken', { path: '/' });

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// --- Auth middleware ---
function authMiddleware(req, res, next) {
  const token = req.cookies.accessToken;
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// --- Protected route example ---
app.get('/profile', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, email, created_at FROM users WHERE id=$1',
      [req.user.userId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Auth service running on port ${PORT}`));
