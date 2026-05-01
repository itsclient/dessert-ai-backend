/**
 * Database abstraction layer.
 * Uses PostgreSQL when DATABASE_URL is set (cloud/Render), otherwise SQLite (local dev).
 */

const path = require('path');

let db;
let isPostgres = false;
let sqlite3;

// PostgreSQL helpers
let pgPool;

// SQLite helpers (will be defined after sqlite3 is loaded)
let sqliteRun, sqliteGet, sqliteAll;

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

    // New tables for enhanced features
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS ai_chat_messages (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        message_text TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS group_challenges (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        challenge_type TEXT,
        difficulty TEXT,
        start_date DATE,
        end_date DATE,
        max_participants INTEGER,
        current_participants INTEGER DEFAULT 0,
        prize_pool INTEGER DEFAULT 0,
        requirements TEXT,
        rewards TEXT,
        created_by TEXT NOT NULL REFERENCES users(email),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS challenge_participants (
        id SERIAL PRIMARY KEY,
        challenge_id INTEGER REFERENCES group_challenges(id),
        user_email TEXT NOT NULL REFERENCES users(email),
        score INTEGER DEFAULT 0,
        rank INTEGER DEFAULT 0,
        progress REAL DEFAULT 0.0,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        max_size INTEGER,
        current_size INTEGER DEFAULT 1,
        challenge_type TEXT,
        created_by TEXT NOT NULL REFERENCES users(email),
        members TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS smart_camera_scans (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        food_name TEXT NOT NULL,
        confidence REAL,
        calories INTEGER,
        protein_grams REAL,
        carbs_grams REAL,
        fat_grams REAL,
        fiber_grams REAL DEFAULT 0.0,
        sugar_grams REAL DEFAULT 0.0,
        sodium INTEGER DEFAULT 0,
        serving_size TEXT,
        scan_source TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS allergy_scans (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        barcode TEXT,
        product_name TEXT,
        detected_allergens TEXT,
        dietary_violations TEXT,
        is_safe BOOLEAN DEFAULT FALSE,
        recommendations TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS user_goals (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        goal_type TEXT NOT NULL,
        target_value REAL,
        current_value REAL DEFAULT 0.0,
        unit TEXT,
        deadline DATE,
        is_completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        achievement_type TEXT NOT NULL,
        achievement_name TEXT NOT NULL,
        points_awarded INTEGER DEFAULT 0,
        earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS metabolic_profiles (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        age INTEGER,
        gender TEXT,
        height_cm REAL,
        weight_kg REAL,
        activity_level TEXT,
        bmr INTEGER,
        tdee INTEGER,
        target_calories INTEGER,
        protein_grams REAL,
        carb_grams REAL,
        fat_grams REAL,
        goal TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS recipe_saves (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        recipe_name TEXT NOT NULL,
        recipe_data TEXT,
        saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        preference_type TEXT NOT NULL,
        preference_value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    // Tables for advanced admin features (12 improvements)
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS user_journey_stages (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        stage TEXT NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_email, stage)
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS scheduled_reports (
        id SERIAL PRIMARY KEY,
        report_name TEXT NOT NULL,
        frequency TEXT NOT NULL,
        email_recipients TEXT NOT NULL,
        last_sent TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS daily_active_users (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        active_date DATE NOT NULL,
        activity_count INTEGER DEFAULT 1,
        UNIQUE(user_email, active_date)
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS alert_rules (
        id SERIAL PRIMARY KEY,
        alert_name TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        threshold_value REAL,
        comparison_operator TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        email_notifications BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS alert_history (
        id SERIAL PRIMARY KEY,
        alert_rule_id INTEGER REFERENCES alert_rules(id),
        triggered_value REAL,
        message TEXT,
        is_resolved BOOLEAN DEFAULT FALSE,
        triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS online_users (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        session_id TEXT NOT NULL,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT,
        user_agent TEXT,
        UNIQUE(user_email, session_id)
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS cms_content (
        id SERIAL PRIMARY KEY,
        content_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        metadata TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_by TEXT NOT NULL REFERENCES users(email),
        updated_by TEXT REFERENCES users(email),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS user_impersonation_logs (
        id SERIAL PRIMARY KEY,
        admin_email TEXT NOT NULL REFERENCES users(email),
        target_user_email TEXT NOT NULL REFERENCES users(email),
        action TEXT NOT NULL,
        ip_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS ab_tests (
        id SERIAL PRIMARY KEY,
        test_name TEXT NOT NULL,
        variant_a_name TEXT NOT NULL,
        variant_b_name TEXT NOT NULL,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS ab_test_results (
        id SERIAL PRIMARY KEY,
        test_id INTEGER REFERENCES ab_tests(id),
        user_email TEXT NOT NULL REFERENCES users(email),
        variant TEXT NOT NULL,
        conversion_event TEXT,
        converted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS revenue_tracking (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email),
        transaction_type TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        description TEXT,
        transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS integration_health (
        id SERIAL PRIMARY KEY,
        service_name TEXT NOT NULL,
        service_type TEXT NOT NULL,
        status TEXT NOT NULL,
        response_time_ms INTEGER,
        last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        error_message TEXT,
        is_critical BOOLEAN DEFAULT FALSE,
        UNIQUE(service_name)
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS export_schedules (
        id SERIAL PRIMARY KEY,
        export_name TEXT NOT NULL,
        export_type TEXT NOT NULL,
        frequency TEXT NOT NULL,
        destination TEXT NOT NULL,
        email_recipients TEXT,
        last_exported TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('DATABASE: PostgreSQL tables created/verified');

  } else {
    console.log('DATABASE: Using SQLite (local mode)');
    isPostgres = false;
    sqlite3 = require('sqlite3').verbose();
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

        // New tables for enhanced features
        db.run(`CREATE TABLE IF NOT EXISTS ai_chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          message_text TEXT NOT NULL,
          sender_type TEXT NOT NULL, -- 'user' or 'ai'
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS group_challenges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          challenge_type TEXT,
          difficulty TEXT,
          start_date DATETIME,
          end_date DATETIME,
          max_participants INTEGER,
          current_participants INTEGER DEFAULT 0,
          prize_pool INTEGER DEFAULT 0,
          requirements TEXT, -- JSON array
          rewards TEXT, -- JSON array
          created_by TEXT NOT NULL,
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS challenge_participants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          challenge_id INTEGER NOT NULL,
          user_email TEXT NOT NULL,
          score INTEGER DEFAULT 0,
          rank INTEGER DEFAULT 0,
          progress REAL DEFAULT 0.0,
          joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (challenge_id) REFERENCES group_challenges(id),
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS teams (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          max_size INTEGER,
          current_size INTEGER DEFAULT 1,
          challenge_type TEXT,
          created_by TEXT NOT NULL,
          members TEXT, -- JSON array of team members
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT 1,
          FOREIGN KEY (created_by) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS smart_camera_scans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          food_name TEXT NOT NULL,
          confidence REAL,
          calories INTEGER,
          protein_grams REAL,
          carbs_grams REAL,
          fat_grams REAL,
          fiber_grams REAL DEFAULT 0.0,
          sugar_grams REAL DEFAULT 0.0,
          sodium INTEGER DEFAULT 0,
          serving_size TEXT,
          scan_source TEXT, -- 'localML', 'googleVision', 'customAPI'
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS allergy_scans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          barcode TEXT,
          product_name TEXT,
          detected_allergens TEXT, -- JSON array
          dietary_violations TEXT, -- JSON array
          is_safe BOOLEAN DEFAULT 0,
          recommendations TEXT, -- JSON array
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS user_goals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          goal_type TEXT NOT NULL,
          target_value REAL,
          current_value REAL DEFAULT 0.0,
          unit TEXT,
          deadline DATE,
          is_completed BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS user_achievements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          achievement_type TEXT NOT NULL,
          achievement_name TEXT NOT NULL,
          points_awarded INTEGER DEFAULT 0,
          earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS metabolic_profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          age INTEGER,
          gender TEXT,
          height_cm REAL,
          weight_kg REAL,
          activity_level TEXT,
          bmr INTEGER,
          tdee INTEGER,
          target_calories INTEGER,
          protein_grams REAL,
          carb_grams REAL,
          fat_grams REAL,
          goal TEXT, -- 'lose', 'maintain', 'gain'
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS recipe_saves (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          recipe_name TEXT NOT NULL,
          recipe_data TEXT, -- JSON object with recipe details
          saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS user_preferences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          preference_type TEXT NOT NULL,
          preference_value TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        const bcrypt = require('bcryptjs');
        const adminPassword = bcrypt.hashSync('admin123', 10);
        db.run(`INSERT OR IGNORE INTO users (email, username, name, password, role) 
                VALUES (?, ?, ?, ?, ?)`, 
                ['admin@gmail.com', 'Admin', 'NutriVision Admin', adminPassword, 'admin'], 
                (err) => {
                  if (err) console.error('Error seeding admin:', err);
                });

        // Tables for advanced admin features (12 improvements)
        db.run(`CREATE TABLE IF NOT EXISTS user_journey_stages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          stage TEXT NOT NULL,
          completed BOOLEAN DEFAULT 0,
          completed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_email, stage),
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS scheduled_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          report_name TEXT NOT NULL,
          frequency TEXT NOT NULL,
          email_recipients TEXT NOT NULL,
          last_sent DATETIME,
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS daily_active_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          active_date DATE NOT NULL,
          activity_count INTEGER DEFAULT 1,
          UNIQUE(user_email, active_date),
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS alert_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          alert_name TEXT NOT NULL,
          alert_type TEXT NOT NULL,
          threshold_value REAL,
          comparison_operator TEXT,
          is_active BOOLEAN DEFAULT 1,
          email_notifications BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS alert_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          alert_rule_id INTEGER,
          triggered_value REAL,
          message TEXT,
          is_resolved BOOLEAN DEFAULT 0,
          triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          resolved_at DATETIME,
          FOREIGN KEY (alert_rule_id) REFERENCES alert_rules(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS online_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          session_id TEXT NOT NULL,
          last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
          ip_address TEXT,
          user_agent TEXT,
          UNIQUE(user_email, session_id),
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS cms_content (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content_type TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT,
          metadata TEXT,
          is_active BOOLEAN DEFAULT 1,
          created_by TEXT NOT NULL,
          updated_by TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(email),
          FOREIGN KEY (updated_by) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS user_impersonation_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          admin_email TEXT NOT NULL,
          target_user_email TEXT NOT NULL,
          action TEXT NOT NULL,
          ip_address TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (admin_email) REFERENCES users(email),
          FOREIGN KEY (target_user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS ab_tests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          test_name TEXT NOT NULL,
          variant_a_name TEXT NOT NULL,
          variant_b_name TEXT NOT NULL,
          start_date DATETIME,
          end_date DATETIME,
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS ab_test_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          test_id INTEGER,
          user_email TEXT NOT NULL,
          variant TEXT NOT NULL,
          conversion_event TEXT,
          converted BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (test_id) REFERENCES ab_tests(id),
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS revenue_tracking (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email TEXT NOT NULL,
          transaction_type TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT DEFAULT 'USD',
          description TEXT,
          transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_email) REFERENCES users(email)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS integration_health (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          service_name TEXT NOT NULL UNIQUE,
          service_type TEXT NOT NULL,
          status TEXT NOT NULL,
          response_time_ms INTEGER,
          last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
          error_message TEXT,
          is_critical BOOLEAN DEFAULT 0
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS export_schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          export_name TEXT NOT NULL,
          export_type TEXT NOT NULL,
          frequency TEXT NOT NULL,
          destination TEXT NOT NULL,
          email_recipients TEXT,
          last_exported DATETIME,
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
          if (err) console.error('Error creating tables:', err);
          resolve();
        });
      });
    });

    console.log('DATABASE: SQLite tables created/verified');
  }

  // Helper to promisify sqlite3 methods (defined after sqlite3 is loaded)
  sqliteRun = function(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  };

  sqliteGet = function(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  };

  sqliteAll = function(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  };
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
