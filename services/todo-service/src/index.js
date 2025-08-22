require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.TODO_DB_URL,
});

// Health check
app.get('/health', (req, res) => res.send('ok'));

// Get all todos
app.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM todos ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Create a todo
app.post('/', async (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    try {
        const { rows } = await pool.query(
            'INSERT INTO todos(title) VALUES($1) RETURNING *',
            [title]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Todo service running on port ${PORT}`));
