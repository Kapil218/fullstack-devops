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
app.get("/todos", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM todos ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get a single todo by ID
app.get("/todos/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM todos WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Todo not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Create new todo
app.post("/todos", async (req, res) => {
  const { title, description, status } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO todos (title, description, status) VALUES ($1, $2, $3) RETURNING *",
      [title, description, status || "Todo"]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Update todo (status, title, description)
app.put("/todos/:id", async (req, res) => {
  const { id } = req.params;
  const { title, description, status } = req.body;
  try {
    const result = await pool.query(
      "UPDATE todos SET title=$1, description=$2, status=$3 WHERE id=$4 RETURNING *",
      [title, description, status, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Soft delete → move to Deleted column
app.delete("/todos/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "UPDATE todos SET status='Deleted' WHERE id=$1 RETURNING *",
      [id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Permanent delete
app.delete("/todos/:id/permanent", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM todos WHERE id=$1", [id]);
    res.json({ success: true, message: "Todo permanently deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Todo service running on port ${PORT}`));
