const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'cv.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    title TEXT,
    markdown TEXT NOT NULL,
    html TEXT NOT NULL,
    json_ld TEXT,
    json_data TEXT,
    pdf_blob BLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_tokens (
    token TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Add columns if migrating existing DB
try {
  db.exec(`ALTER TABLE pages ADD COLUMN json_data TEXT;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE pages ADD COLUMN pdf_blob BLOB;`);
} catch (e) {}

module.exports = db;
