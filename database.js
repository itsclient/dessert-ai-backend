/**
 * Database abstraction layer.
 * Uses PostgreSQL when DATABASE_URL is set (cloud/Render), otherwise SQLite (local dev).
 */

const path = require('path');

let db;
let isPostgres = false;

// Helper to promisify sqlite3 methods
function sqliteRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function sqliteGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function sqliteAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// PostgreSQL helpers
let pgPool;

async function pgRun(sql, params = []) {
  // Convert SQLite ? placeholders to $1, $2, etc.
  let pgSql = sql;
  let paramIndex = 1;
  pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);

  const result = await pgPool.query(pgSql, params);
  return {
    lastID: result.rows[0]?.id || null,
    changes: result.rowCount || 0
  };
}

async function pgGet(sql, params = []) {
  let pgSql = sql;
  let paramIndex = 1;
  pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);

  const result = await pgPool.query(pgSql, params);
  return result.rows[0] || null;
}

async function pgAll(sql, params = []) {
  let pgSql = sql;
  let paramIndex = 1;
  pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);

  const result = await pgPool.query(pgSql, params);
  return result.rows;
}

// Public API — same interface regardless of backend
async function run(sql, params = []) {
  if (isPostgres) return pgRun(sql, params);
  return sqliteRun(sql, params);
}

async function get(sql, params = []) {
  if (isPostgres) return pgGet(sql, params);
  return sqliteGet(sql, params);
}

async function all(sql, params = []) {
  if (isPostgres) return pgAll(sql, params);
  return sqliteAll(sql, params);
}

async function initialize() {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    console.log('DATABASE: Using PostgreSQL');
    isPostgres = true;
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // Test connection
    const client = await pgPool.connect();
    console.log('DATABASE: PostgreSQL connected successfully');
    client.release();

    // Create tables (PostgreSQL syntax)
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        username TEXT,
        name TEXT,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS scans (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        dessert_name TEXT NOT NULL,
        confidence REAL,
        calories INTEGER,
        protein_grams REAL,
        carbs_grams REAL,
        fat_grams REAL,
        category TEXT,
        is_favorite INTEGER DEFAULT 0,
        image_base64 TEXT,
        scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS activities (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        activity_type TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed admin
    const bcrypt = require('bcryptjs');
    const adminPassword = bcrypt.hashSync('admin123', 10);
    await pgPool.query(`
      INSERT INTO users (email, username, name, password, role)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING
    `, ['admin@gmail.com', 'Admin', 'NutriVision Admin', adminPassword, 'admin']);

    console.log('DATABASE: PostgreSQL tables created/verified');

  } else {
    console.log('DATABASE: Using SQLite (local mode)');
    isPostgres = false;
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database('./dessert_ai_admin.db');

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          username TEXT,
          name TEXT,
          password TEXT NOT NULL,
          role TEXT DEFAULT 'user',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS scans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          dessert_name TEXT NOT NULL,
          confidence REAL,
          calories INTEGER,
          protein_grams REAL,
          carbs_grams REAL,
          fat_grams REAL,
          category TEXT,
          is_favorite INTEGER DEFAULT 0,
          image_base64 TEXT,
          scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS activities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          activity_type TEXT NOT NULL,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        const bcrypt = require('bcryptjs');
        const adminPassword = bcrypt.hashSync('admin123', 10);
        db.run(`INSERT OR IGNORE INTO users (email, username, name, password, role) VALUES (?, ?, ?, ?, ?)`,
          ['admin@gmail.com', 'Admin', 'NutriVision Admin', adminPassword, 'admin']);

        resolve();
      });
    });

    console.log('DATABASE: SQLite tables created/verified');
  }
}

function getRawDb() {
  return db;
}

function isPostgresMode() {
  return isPostgres;
}

module.exports = {
  initialize,
  run,
  get,
  all,
  getRawDb,
  isPostgresMode
};
