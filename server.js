const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

// Helper: SQL that works on both SQLite and PostgreSQL
function dateFunc(expr) {
  if (db.isPostgresMode()) {
    // Convert SQLite date functions to PostgreSQL equivalents
    return expr
      .replace(/DATE\('now'\)/g, "CURRENT_DATE")
      .replace(/datetime\('now',\s*'(-?\d+)\s*days?'\)/g, (m, n) => `CURRENT_TIMESTAMP - INTERVAL '${n} days'`)
      .replace(/datetime\('now',\s*'(-?\d+)\s*hours?'\)/g, (m, n) => `CURRENT_TIMESTAMP - INTERVAL '${n} hours'`)
      .replace(/strftime\('%H',\s*(\w+)\)/g, 'EXTRACT(HOUR FROM $1)::text')
      .replace(/DATE\((\w+)\)/g, '$1::date');
  }
  return expr;
}

// Activity deduplication cache (userEmail + type -> last timestamp)
const activityCache = new Map();
const ACTIVITY_DEDUP_WINDOW = 5000; // 5 seconds

// Helper: log activity (with duplicate prevention)
async function logActivity(userEmail, type, description) {
  const key = `${userEmail}:${type}`;
  const now = Date.now();
  const lastLogged = activityCache.get(key);

  if (lastLogged && (now - lastLogged) < ACTIVITY_DEDUP_WINDOW) {
    return;
  }

  activityCache.set(key, now);

  if (activityCache.size > 100) {
    const cutoff = now - ACTIVITY_DEDUP_WINDOW;
    for (const [k, v] of activityCache.entries()) {
      if (v < cutoff) activityCache.delete(k);
    }
  }

  try {
    await db.run('INSERT INTO activities (user_email, activity_type, description) VALUES (?, ?, ?)',
      [userEmail, type, description]);
  } catch (err) {
    console.error('Activity log error:', err);
  }
}

// ===================== API ROUTES =====================

// Sync user data from mobile app
app.post('/api/sync', async (req, res) => {
  const { user, scans } = req.body;

  if (!user || !user.email) {
    return res.status(400).json({ error: 'User data required' });
  }

  console.log('SYNC: Received sync request for user:', user.email);
  console.log('SYNC: Scans to sync:', scans?.length || 0);

  try {
    const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [user.email]);

    if (!existingUser) {
      await db.run(`
        INSERT INTO users (email, username, name, password, role)
        VALUES (?, ?, ?, ?, 'user')
      `, [user.email, user.username, user.name, user.password]);
      console.log('SYNC: Created new user:', user.email);
    } else {
      console.log('SYNC: User exists:', user.email);
    }

    if (scans && scans.length > 0) {
      let newCount = 0;
      const validScans = scans.filter(scan => {
        const dessertName = scan.dessert_name || scan.dessert || 'Unknown Dessert';
        return dessertName && dessertName.trim() !== '';
      });

      if (validScans.length === 0) {
        console.log('SYNC: No valid scans to process');
        return res.json({ success: true, message: 'No valid scans to sync' });
      }

      for (const scan of validScans) {
        const scanDate = scan.timestamp || scan.scanned_at || new Date().toISOString();
        const dessertName = scan.dessert_name || scan.dessert || 'Unknown Dessert';

        const existingScan = await db.get(
          `SELECT id FROM scans WHERE user_email = ? AND dessert_name = ? AND calories = ? AND scanned_at = ?`,
          [user.email, dessertName, scan.calories || 0, scanDate]
        );

        if (existingScan) {
          console.log('SYNC: Scan already exists, skipping:', dessertName);
        } else {
          await db.run(`
            INSERT INTO scans 
            (user_email, dessert_name, confidence, calories, protein_grams, carbs_grams, fat_grams, category, is_favorite, image_base64, scanned_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            user.email, dessertName, scan.confidence || 0,
            scan.calories || 0, scan.protein_grams || 0,
            scan.carbs_grams || 0, scan.fat_grams || 0,
            scan.category || 'Unknown',
            scan.is_favorite ? 1 : 0,
            scan.image_base64 || null,
            scanDate
          ]);
          newCount++;
          logActivity(user.email, 'scan', `Scanned: ${dessertName} (${scan.calories} cal)`);
        }
      }

      console.log('SYNC: Synced', newCount, 'new scans (skipped', validScans.length - newCount, 'duplicates)');
      if (newCount > 0) {
        logActivity(user.email, 'sync', `Synced ${newCount} new scans`);
      }
      res.json({ success: true, message: `Synced ${newCount} new scans` });
    } else {
      console.log('SYNC: No scans to process');
      res.json({ success: true, message: 'No scans to sync' });
    }
  } catch (error) {
    console.error('SYNC: Sync error:', error);
    res.status(500).json({ error: 'Sync failed: ' + error.message });
  }
});

// User registration
app.post('/api/register', async (req, res) => {
  const { email, username, name, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const row = await db.get('SELECT id FROM users WHERE email = ?', [email]);

    if (row) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    await db.run(
      'INSERT INTO users (email, username, name, password, role) VALUES (?, ?, ?, ?, ?)',
      [email, username || null, name || null, hashedPassword, 'user']
    );
    logActivity(email, 'register', `New user registered: ${username || email}`);
    res.status(201).json({ success: true, message: 'User created successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

// User login (by email)
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE email = ? AND role = ?', [email, 'user']);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (bcrypt.compareSync(password, user.password)) {
      logActivity(user.email, 'login', `User logged in: ${user.username || user.email}`);
      res.json({
        success: true,
        user: {
          email: user.email,
          username: user.username,
          name: user.name,
          role: user.role
        }
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// User login (by username)
app.post('/api/login-username', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE username = ? AND role = ?', [username, 'user']);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (bcrypt.compareSync(password, user.password)) {
      logActivity(user.email, 'login', `User logged in via username: ${user.username}`);
      res.json({
        success: true,
        user: {
          email: user.email,
          username: user.username,
          name: user.name,
          role: user.role
        }
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Update user profile
app.put('/api/user/profile', async (req, res) => {
  const { email, username, name } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    await db.run('UPDATE users SET username = ?, name = ? WHERE email = ?',
      [username || null, name || null, email]);
    logActivity(email, 'profile_update', `Profile updated: ${username || email}`);
    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Change user password
app.put('/api/user/password', async (req, res) => {
  const { email, current_password, new_password } = req.body;

  if (!email || !current_password || !new_password) {
    return res.status(400).json({ error: 'All fields required' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!bcrypt.compareSync(current_password, user.password)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedNewPassword = bcrypt.hashSync(new_password, 10);
    await db.run('UPDATE users SET password = ? WHERE email = ?',
      [hashedNewPassword, email]);
    logActivity(email, 'password_change', 'Password changed');
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Check if user exists
app.get('/api/user/check/:email', async (req, res) => {
  const { email } = req.params;

  try {
    const row = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    res.json({ exists: !!row });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await db.get('SELECT * FROM users WHERE email = ? AND role = ?', [email, 'admin']);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (bcrypt.compareSync(password, user.password)) {
      res.json({
        success: true,
        user: {
          email: user.email,
          username: user.username,
          role: user.role
        }
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all users (admin only)
app.get('/api/admin/users', async (req, res) => {
  try {
    const rows = await db.all('SELECT id, email, username, name, role, created_at FROM users WHERE role = ?', ['user']);
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all scans (admin only)
app.get('/api/admin/scans', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT s.*, u.username, u.name 
      FROM scans s 
      LEFT JOIN users u ON s.user_email = u.email 
      ORDER BY s.scanned_at DESC
    `);
    res.json({ scans: rows });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Get dashboard stats
app.get('/api/admin/stats', async (req, res) => {
  try {
    const userCount = await db.get('SELECT COUNT(*) as total_users FROM users WHERE role = ?', ['user']);
    const scanCount = await db.get('SELECT COUNT(*) as total_scans FROM scans');
    const avgCals = await db.get('SELECT AVG(calories) as avg_calories FROM scans');
    const categories = await db.all(`
      SELECT category, COUNT(*) as count 
      FROM scans 
      GROUP BY category 
      ORDER BY count DESC 
      LIMIT 5
    `);
    const dailyStats = await db.all(dateFunc(`
      SELECT DATE(scanned_at) as date, COUNT(*) as scan_count, SUM(calories) as total_calories
      FROM scans
      GROUP BY DATE(scanned_at)
      ORDER BY date DESC
      LIMIT 30
    `));

    res.json({
      total_users: userCount.total_users,
      total_scans: scanCount.total_scans,
      avg_calories: Math.round(avgCals.avg_calories || 0),
      top_categories: categories,
      daily_stats: dailyStats
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete user (admin only)
app.delete('/api/admin/users/:email', async (req, res) => {
  const email = req.params.email;

  try {
    await db.run('DELETE FROM scans WHERE user_email = ?', [email]);
    await db.run('DELETE FROM activities WHERE user_email = ?', [email]);
    await db.run('DELETE FROM users WHERE email = ? AND role = ?', [email, 'user']);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all activities (admin only)
app.get('/api/admin/activities', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT a.*, u.username, u.name 
      FROM activities a 
      LEFT JOIN users u ON a.user_email = u.email 
      ORDER BY a.created_at DESC
      LIMIT 100
    `);
    res.json({ activities: rows });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Main Analytics Dashboard
app.get('/api/admin/analytics', async (req, res) => {
  try {
    const queries = {
      totalUsers: `SELECT COUNT(*) as count FROM users WHERE role = 'user'`,
      totalScans: `SELECT COUNT(*) as count FROM scans`,
      totalCalories: `SELECT SUM(calories) as total FROM scans`,
      avgCalories: `SELECT AVG(calories) as avg FROM scans`,
      scansToday: dateFunc(`SELECT COUNT(*) as count FROM scans WHERE DATE(scanned_at) = DATE('now')`),
      caloriesToday: dateFunc(`SELECT SUM(calories) as total FROM scans WHERE DATE(scanned_at) = DATE('now')`)
    };

    const results = {};
    const entries = Object.entries(queries);

    await Promise.all(entries.map(async ([key, query]) => {
      try {
        const row = await db.get(query);
        results[key] = row ? (row.count || row.total || row.avg || 0) : 0;
      } catch (err) {
        console.error(`Analytics query error (${key}):`, err);
        results[key] = 0;
      }
    }));

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// User Analytics Dashboard
app.get('/api/admin/analytics/users', async (req, res) => {
  try {
    const queries = {
      growth: dateFunc(`SELECT DATE(created_at) as date, COUNT(*) as new_users 
               FROM users WHERE role = 'user' 
               GROUP BY DATE(created_at) 
               ORDER BY date DESC LIMIT 30`),
      leaderboard: `SELECT u.email, u.username, u.name, COUNT(s.id) as scan_count
                    FROM users u LEFT JOIN scans s ON u.email = s.user_email
                    WHERE u.role = 'user'
                    GROUP BY u.email, u.username, u.name
                    ORDER BY scan_count DESC LIMIT 10`,
      retention: dateFunc(`SELECT 
                    COUNT(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 END) as new_users,
                    COUNT(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 END) as monthly_users,
                    COUNT(*) as total_users
                  FROM users WHERE role = 'user'`),
      avgScans: `SELECT AVG(scan_count) as avg_scans
                FROM (
                  SELECT COUNT(s.id) as scan_count
                  FROM users u LEFT JOIN scans s ON u.email = s.user_email
                  WHERE u.role = 'user'
                  GROUP BY u.email
                )`
    };

    const results = {};
    const entries = Object.entries(queries);

    await Promise.all(entries.map(async ([key, query]) => {
      try {
        const rows = await db.all(query);
        results[key] = rows;
      } catch (err) {
        console.error(`Analytics query error (${key}):`, err);
        results[key] = [];
      }
    }));

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Real-time alerts data
app.get('/api/admin/alerts', async (req, res) => {
  const alerts = [];

  try {
    // Build queries based on database type
    const newUserQuery = db.isPostgresMode()
      ? `SELECT COUNT(*) as count FROM users WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour' AND role = 'user'`
      : `SELECT COUNT(*) as count FROM users WHERE created_at >= datetime('now', '-1 hour') AND role = 'user'`;
    
    const highCalQuery = db.isPostgresMode()
      ? `SELECT COUNT(*) as count FROM scans WHERE calories > 800 AND scanned_at >= CURRENT_TIMESTAMP - INTERVAL '2 hours'`
      : `SELECT COUNT(*) as count FROM scans WHERE calories > 800 AND scanned_at >= datetime('now', '-2 hours')`;

    const newUserRow = await db.get(newUserQuery);
    if (newUserRow && newUserRow.count > 0) {
      alerts.push({
        type: 'new_users',
        message: `${newUserRow.count} new user(s) in the last hour`,
        level: 'info',
        count: newUserRow.count
      });
    }

    const highCalRow = await db.get(highCalQuery);
    if (highCalRow && highCalRow.count > 0) {
      alerts.push({
        type: 'high_calories',
        message: `${highCalRow.count} high-calorie scans detected (>800 cal)`,
        level: 'warning',
        count: highCalRow.count
      });
    }

    const memoryUsage = process.memoryUsage();
    if (memoryUsage.heapUsed / 1024 / 1024 > 100) {
      alerts.push({
        type: 'memory',
        message: `High memory usage: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        level: 'error'
      });
    }

    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Mobile app integration endpoints
app.get('/api/admin/mobile/stats', async (req, res) => {
  try {
    const deviceRow = await db.get(`SELECT COUNT(DISTINCT email) as total_devices FROM users WHERE role = 'user'`);
    // For PostgreSQL: use CURRENT_TIMESTAMP - INTERVAL; for SQLite: use datetime('now', '-24 hours')
    const activeQuery = db.isPostgresMode()
      ? `SELECT COUNT(DISTINCT user_email) as active_devices FROM scans WHERE scanned_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'`
      : `SELECT COUNT(DISTINCT user_email) as active_devices FROM scans WHERE scanned_at >= datetime('now', '-24 hours')`;
    const activeRow = await db.get(activeQuery);

    res.json({
      app_version: '2.0.0',
      total_devices: deviceRow ? deviceRow.total_devices : 0,
      active_devices: activeRow ? activeRow.active_devices : 0,
      crash_reports: 0,
      push_notifications_sent: 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Performance monitoring
app.get('/api/admin/performance', (req, res) => {
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();

  res.json({
    uptime: Math.round(uptime),
    memory: {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      external: Math.round(memoryUsage.external / 1024 / 1024)
    },
    cpu: process.cpuUsage(),
    node_version: process.version
  });
});

// User segmentation
app.get('/api/admin/segments', async (req, res) => {
  try {
    // PostgreSQL doesn't allow aliases in HAVING, so we use subqueries
    if (db.isPostgresMode()) {
      const activeUsers = await db.all(`
        SELECT * FROM (
          SELECT u.email, u.username, u.name, COUNT(s.id) as scan_count, MAX(s.scanned_at) as last_scan
          FROM users u LEFT JOIN scans s ON u.email = s.user_email
          WHERE u.role = 'user'
          GROUP BY u.email, u.username, u.name
        ) sub
        WHERE last_scan IS NOT NULL AND last_scan >= CURRENT_TIMESTAMP - INTERVAL '7 days'`);

      const inactiveUsers = await db.all(`
        SELECT * FROM (
          SELECT u.email, u.username, u.name, COUNT(s.id) as scan_count, MAX(s.scanned_at) as last_scan
          FROM users u LEFT JOIN scans s ON u.email = s.user_email
          WHERE u.role = 'user'
          GROUP BY u.email, u.username, u.name
        ) sub
        WHERE last_scan IS NULL OR last_scan < CURRENT_TIMESTAMP - INTERVAL '7 days'`);

      res.json({ active: activeUsers, inactive: inactiveUsers });
    } else {
      // SQLite - original queries work fine
      const activeUsers = await db.all(`SELECT u.email, u.username, u.name, COUNT(s.id) as scan_count, MAX(s.scanned_at) as last_scan
              FROM users u LEFT JOIN scans s ON u.email = s.user_email
              WHERE u.role = 'user'
              GROUP BY u.email, u.username, u.name
              HAVING last_scan IS NOT NULL AND last_scan >= datetime('now', '-7 days')`);

      const inactiveUsers = await db.all(`SELECT u.email, u.username, u.name, COUNT(s.id) as scan_count, MAX(s.scanned_at) as last_scan
              FROM users u LEFT JOIN scans s ON u.email = s.user_email
              WHERE u.role = 'user'
              GROUP BY u.email, u.username, u.name
              HAVING last_scan IS NULL OR last_scan < datetime('now', '-7 days')`);

      res.json({ active: activeUsers, inactive: inactiveUsers });
    }
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Advanced analytics
app.get('/api/admin/analytics/advanced', async (req, res) => {
  try {
    const trends = await db.all(dateFunc(`SELECT DATE(scanned_at) as date, COUNT(*) as scans
            FROM scans 
            WHERE scanned_at >= datetime('now', '-30 days')
            GROUP BY DATE(scanned_at)
            ORDER BY date`));

    const correlations = await db.all(`SELECT category, AVG(calories) as avg_calories, COUNT(*) as count
            FROM scans 
            WHERE category IS NOT NULL
            GROUP BY category
            ORDER BY count DESC`);

    const seasonal = await db.all(dateFunc(`SELECT strftime('%H', scanned_at) as hour, COUNT(*) as count
            FROM scans 
            WHERE scanned_at >= datetime('now', '-7 days')
            GROUP BY hour
            ORDER BY hour`));

    res.json({
      trends: trends,
      correlations: correlations,
      seasonal: seasonal
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Initialize database then start server
db.initialize().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NutriVision Admin API running on http://0.0.0.0:${PORT}`);
    console.log(`Admin dashboard: http://localhost:${PORT}`);
    console.log(`Database: ${db.isPostgresMode() ? 'PostgreSQL' : 'SQLite'}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app;
