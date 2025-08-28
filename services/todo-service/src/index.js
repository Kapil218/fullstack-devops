import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authMiddleware from "../authMiddleware.js";

const { Pool } = pg;
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const pool = new Pool({
  connectionString: process.env.TODO_DB_URL,
});

// Health check
app.get("/health", (req, res) => res.send("ok"));

// ✅ Protect all routes with auth
app.use(authMiddleware);

// ------------------- CONTROLLERS -------------------

// Get all todos for logged-in user
app.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM todos WHERE user_id = $1 ORDER BY id ASC",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get a single todo by ID (must match user)
app.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM todos WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Todo not found or access denied" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Create new todo (user is taken from token)
app.post("/", async (req, res) => {
  const { title, description, status } = req.body;

  try {
    const result = await pool.query(
      "INSERT INTO todos (title, description, status, user_id) VALUES ($1, $2, $3, $4) RETURNING *",
      [title, description, status || "Todo", req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Update todo (only if owner)
app.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { title, description, status } = req.body;

  try {
    const result = await pool.query(
      "UPDATE todos SET title=$1, description=$2, status=$3 WHERE id=$4 AND user_id=$5 RETURNING *",
      [title, description, status, id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Todo not found or access denied" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Soft delete (set status=Deleted)
app.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "UPDATE todos SET status='Deleted' WHERE id=$1 AND user_id=$2 RETURNING *",
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Todo not found or access denied" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Permanent delete
app.delete("/:id/permanent", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM todos WHERE id=$1 AND user_id=$2 RETURNING *",
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Todo not found or access denied" });
    }
    res.json({ success: true, message: "Todo permanently deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// ------------------- SERVER -------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Todo service running on port ${PORT}`));
