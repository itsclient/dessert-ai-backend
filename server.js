const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

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

// === NEW API ENDPOINTS FOR ENHANCED FEATURES ===

// AI Chat Messages
app.post('/api/ai-chat/messages', async (req, res) => {
  try {
    const { userEmail, messageText, senderType } = req.body;
    
    await db.run(
      'INSERT INTO ai_chat_messages (user_email, message_text, sender_type) VALUES (?, ?, ?)',
      [userEmail, messageText, senderType]
    );
    
    await logActivity(userEmail, 'ai_chat', 'Sent AI chat message');
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving AI chat message:', error);
    res.status(500).json({ error: 'Failed to save message' });
  }
});

app.get('/api/ai-chat/messages/:userEmail', async (req, res) => {
  try {
    const { userEmail } = req.params;
    const messages = await db.all(
      'SELECT * FROM ai_chat_messages WHERE user_email = ? ORDER BY timestamp DESC LIMIT 50',
      [userEmail]
    );
    res.json(messages);
  } catch (error) {
    console.error('Error fetching AI chat messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/api/ai-chat/messages/all', async (req, res) => {
  try {
    const messages = await db.all(
      'SELECT * FROM ai_chat_messages ORDER BY timestamp DESC LIMIT 100'
    );
    res.json(messages);
  } catch (error) {
    console.error('Error fetching all AI chat messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Group Challenges
app.post('/api/challenges', async (req, res) => {
  try {
    const { name, description, challengeType, difficulty, startDate, endDate, maxParticipants, prizePool, requirements, rewards, createdBy } = req.body;
    
    const result = await db.run(
      'INSERT INTO group_challenges (name, description, challenge_type, difficulty, start_date, end_date, max_participants, prize_pool, requirements, rewards, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, description, challengeType, difficulty, startDate, endDate, maxParticipants, prizePool, JSON.stringify(requirements), JSON.stringify(rewards), createdBy]
    );
    
    await logActivity(createdBy, 'challenge_created', `Created challenge: ${name}`);
    res.json({ success: true, challengeId: result.lastID });
  } catch (error) {
    console.error('Error creating challenge:', error);
    res.status(500).json({ error: 'Failed to create challenge' });
  }
});

app.get('/api/challenges', async (req, res) => {
  try {
    const challenges = await db.all('SELECT * FROM group_challenges WHERE is_active = 1 ORDER BY created_at DESC');
    res.json(challenges);
  } catch (error) {
    console.error('Error fetching challenges:', error);
    res.status(500).json({ error: 'Failed to fetch challenges' });
  }
});

app.post('/api/challenges/:challengeId/join', async (req, res) => {
  try {
    const { challengeId } = req.params;
    const { userEmail } = req.body;
    
    // Check if already joined
    const existing = await db.get(
      'SELECT * FROM challenge_participants WHERE challenge_id = ? AND user_email = ?',
      [challengeId, userEmail]
    );
    
    if (existing) {
      return res.status(400).json({ error: 'Already joined challenge' });
    }
    
    await db.run(
      'INSERT INTO challenge_participants (challenge_id, user_email) VALUES (?, ?)',
      [challengeId, userEmail]
    );
    
    // Update participant count
    await db.run(
      'UPDATE group_challenges SET current_participants = current_participants + 1 WHERE id = ?',
      [challengeId]
    );
    
    await logActivity(userEmail, 'challenge_joined', `Joined challenge ${challengeId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error joining challenge:', error);
    res.status(500).json({ error: 'Failed to join challenge' });
  }
});

// Smart Camera Scans
app.post('/api/smart-camera/scans', async (req, res) => {
  try {
    const { userEmail, foodName, confidence, calories, protein, carbs, fat, fiber, sugar, sodium, servingSize, scanSource } = req.body;
    
    await db.run(
      'INSERT INTO smart_camera_scans (user_email, food_name, confidence, calories, protein_grams, carbs_grams, fat_grams, fiber_grams, sugar_grams, sodium, serving_size, scan_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userEmail, foodName, confidence, calories, protein, carbs, fat, fiber, sugar, sodium, servingSize, scanSource]
    );
    
    await logActivity(userEmail, 'smart_camera_scan', `Scanned food: ${foodName}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving smart camera scan:', error);
    res.status(500).json({ error: 'Failed to save scan' });
  }
});

app.get('/api/smart-camera/scans/:userEmail', async (req, res) => {
  try {
    const { userEmail } = req.params;
    const scans = await db.all(
      'SELECT * FROM smart_camera_scans WHERE user_email = ? ORDER BY timestamp DESC LIMIT 50',
      [userEmail]
    );
    res.json(scans);
  } catch (error) {
    console.error('Error fetching smart camera scans:', error);
    res.status(500).json({ error: 'Failed to fetch scans' });
  }
});

app.get('/api/smart-camera/scans/all', async (req, res) => {
  try {
    const scans = await db.all(
      'SELECT * FROM smart_camera_scans ORDER BY timestamp DESC LIMIT 100'
    );
    res.json(scans);
  } catch (error) {
    console.error('Error fetching all smart camera scans:', error);
    res.status(500).json({ error: 'Failed to fetch scans' });
  }
});

// Allergy Scans
app.post('/api/allergy-scans', async (req, res) => {
  try {
    const { userEmail, barcode, productName, detectedAllergens, dietaryViolations, isSafe, recommendations } = req.body;
    
    await db.run(
      'INSERT INTO allergy_scans (user_email, barcode, product_name, detected_allergens, dietary_violations, is_safe, recommendations) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userEmail, barcode, productName, JSON.stringify(detectedAllergens), JSON.stringify(dietaryViolations), isSafe, JSON.stringify(recommendations)]
    );
    
    await logActivity(userEmail, 'allergy_scan', `Scanned product: ${productName}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving allergy scan:', error);
    res.status(500).json({ error: 'Failed to save scan' });
  }
});

app.get('/api/allergy-scans/:userEmail', async (req, res) => {
  try {
    const { userEmail } = req.params;
    const scans = await db.all(
      'SELECT * FROM allergy_scans WHERE user_email = ? ORDER BY timestamp DESC LIMIT 50',
      [userEmail]
    );
    res.json(scans);
  } catch (error) {
    console.error('Error fetching allergy scans:', error);
    res.status(500).json({ error: 'Failed to fetch scans' });
  }
});

app.get('/api/allergy-scans/all', async (req, res) => {
  try {
    const scans = await db.all(
      'SELECT * FROM allergy_scans ORDER BY timestamp DESC LIMIT 100'
    );
    res.json(scans);
  } catch (error) {
    console.error('Error fetching all allergy scans:', error);
    res.status(500).json({ error: 'Failed to fetch scans' });
  }
});

// User Goals
app.post('/api/goals', async (req, res) => {
  try {
    const { userEmail, goalType, targetValue, unit, deadline } = req.body;
    
    await db.run(
      'INSERT INTO user_goals (user_email, goal_type, target_value, unit, deadline) VALUES (?, ?, ?, ?, ?)',
      [userEmail, goalType, targetValue, unit, deadline]
    );
    
    await logActivity(userEmail, 'goal_created', `Created ${goalType} goal`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error creating goal:', error);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

app.get('/api/goals/:userEmail', async (req, res) => {
  try {
    const { userEmail } = req.params;
    const goals = await db.all(
      'SELECT * FROM user_goals WHERE user_email = ? ORDER BY created_at DESC',
      [userEmail]
    );
    res.json(goals);
  } catch (error) {
    console.error('Error fetching goals:', error);
    res.status(500).json({ error: 'Failed to fetch goals' });
  }
});

app.get('/api/goals/all', async (req, res) => {
  try {
    const goals = await db.all(
      'SELECT * FROM user_goals ORDER BY created_at DESC LIMIT 100'
    );
    res.json(goals);
  } catch (error) {
    console.error('Error fetching all goals:', error);
    res.status(500).json({ error: 'Failed to fetch goals' });
  }
});

app.put('/api/goals/:goalId', async (req, res) => {
  try {
    const { goalId } = req.params;
    const { currentValue, isCompleted } = req.body;
    
    await db.run(
      'UPDATE user_goals SET current_value = ?, is_completed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [currentValue, isCompleted, goalId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating goal:', error);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

// User Achievements
app.post('/api/achievements', async (req, res) => {
  try {
    const { userEmail, achievementType, achievementName, pointsAwarded } = req.body;
    
    await db.run(
      'INSERT INTO user_achievements (user_email, achievement_type, achievement_name, points_awarded) VALUES (?, ?, ?, ?)',
      [userEmail, achievementType, achievementName, pointsAwarded]
    );
    
    await logActivity(userEmail, 'achievement_earned', `Earned: ${achievementName}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving achievement:', error);
    res.status(500).json({ error: 'Failed to save achievement' });
  }
});

app.get('/api/achievements/:userEmail', async (req, res) => {
  try {
    const { userEmail } = req.params;
    const achievements = await db.all(
      'SELECT * FROM user_achievements WHERE user_email = ? ORDER BY earned_at DESC',
      [userEmail]
    );
    res.json(achievements);
  } catch (error) {
    console.error('Error fetching achievements:', error);
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

app.get('/api/achievements/all', async (req, res) => {
  try {
    const achievements = await db.all(
      'SELECT * FROM user_achievements ORDER BY earned_at DESC LIMIT 100'
    );
    res.json(achievements);
  } catch (error) {
    console.error('Error fetching all achievements:', error);
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

// Metabolic Profiles
app.post('/api/metabolic-profiles', async (req, res) => {
  try {
    const { userEmail, age, gender, heightCm, weightKg, activityLevel, bmr, tdee, targetCalories, proteinGrams, carbGrams, fatGrams, goal } = req.body;
    
    // Check if profile exists
    const existing = await db.get(
      'SELECT * FROM metabolic_profiles WHERE user_email = ?',
      [userEmail]
    );
    
    if (existing) {
      await db.run(
        'UPDATE metabolic_profiles SET age = ?, gender = ?, height_cm = ?, weight_kg = ?, activity_level = ?, bmr = ?, tdee = ?, target_calories = ?, protein_grams = ?, carb_grams = ?, fat_grams = ?, goal = ?, updated_at = CURRENT_TIMESTAMP WHERE user_email = ?',
        [age, gender, heightCm, weightKg, activityLevel, bmr, tdee, targetCalories, proteinGrams, carbGrams, fatGrams, goal, userEmail]
      );
    } else {
      await db.run(
        'INSERT INTO metabolic_profiles (user_email, age, gender, height_cm, weight_kg, activity_level, bmr, tdee, target_calories, protein_grams, carb_grams, fat_grams, goal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [userEmail, age, gender, heightCm, weightKg, activityLevel, bmr, tdee, targetCalories, proteinGrams, carbGrams, fatGrams, goal]
      );
    }
    
    await logActivity(userEmail, 'metabolic_profile_updated', 'Updated metabolic profile');
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving metabolic profile:', error);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

app.get('/api/metabolic-profiles/:userEmail', async (req, res) => {
  try {
    const { userEmail } = req.params;
    const profile = await db.get(
      'SELECT * FROM metabolic_profiles WHERE user_email = ?',
      [userEmail]
    );
    res.json(profile);
  } catch (error) {
    console.error('Error fetching metabolic profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Recipe Saves
app.post('/api/recipe-saves', async (req, res) => {
  try {
    const { userEmail, recipeName, recipeData } = req.body;
    
    await db.run(
      'INSERT INTO recipe_saves (user_email, recipe_name, recipe_data) VALUES (?, ?, ?)',
      [userEmail, recipeName, JSON.stringify(recipeData)]
    );
    
    await logActivity(userEmail, 'recipe_saved', `Saved recipe: ${recipeName}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving recipe:', error);
    res.status(500).json({ error: 'Failed to save recipe' });
  }
});

app.get('/api/recipe-saves/:userEmail', async (req, res) => {
  try {
    const { userEmail } = req.params;
    const recipes = await db.all(
      'SELECT * FROM recipe_saves WHERE user_email = ? ORDER BY saved_at DESC',
      [userEmail]
    );
    res.json(recipes);
  } catch (error) {
    console.error('Error fetching saved recipes:', error);
    res.status(500).json({ error: 'Failed to fetch recipes' });
  }
});

// Enhanced Analytics for Admin
app.get('/api/analytics/overview', async (req, res) => {
  try {
    // Get comprehensive analytics
    const totalUsers = await db.get('SELECT COUNT(*) as count FROM users');
    const totalScans = await db.get('SELECT COUNT(*) as count FROM scans');
    const smartCameraScans = await db.get('SELECT COUNT(*) as count FROM smart_camera_scans');
    const allergyScans = await db.get('SELECT COUNT(*) as count FROM allergy_scans');
    const aiChatMessages = await db.get('SELECT COUNT(*) as count FROM ai_chat_messages');
    const activeChallenges = await db.get('SELECT COUNT(*) as count FROM group_challenges WHERE is_active = 1');
    const totalGoals = await db.get('SELECT COUNT(*) as count FROM user_goals');
    const completedGoals = await db.get('SELECT COUNT(*) as count FROM user_goals WHERE is_completed = 1');
    
    res.json({
      totalUsers: totalUsers.count,
      totalScans: totalScans.count,
      smartCameraScans: smartCameraScans.count,
      allergyScans: allergyScans.count,
      aiChatMessages: aiChatMessages.count,
      activeChallenges: activeChallenges.count,
      totalGoals: totalGoals.count,
      completedGoals: completedGoals.count,
      goalCompletionRate: totalGoals.count > 0 ? (completedGoals.count / totalGoals.count * 100).toFixed(2) : 0
    });
  } catch (error) {
    console.error('Error fetching analytics overview:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Recent Activities for Real-time Dashboard
app.get('/api/activities/recent', async (req, res) => {
  try {
    // Get recent activities from all tables
    const recentActivities = [];
    
    // Get recent AI chat messages
    const chatMessages = await db.all(
      'SELECT user_email, "ai_chat" as activity_type, "Sent AI chat message" as description, timestamp as created_at FROM ai_chat_messages ORDER BY timestamp DESC LIMIT 5'
    );
    recentActivities.push(...chatMessages);
    
    // Get recent smart camera scans
    const cameraScans = await db.all(
      'SELECT user_email, "smart_camera_scan" as activity_type, "Scanned food: " || food_name as description, timestamp as created_at FROM smart_camera_scans ORDER BY timestamp DESC LIMIT 5'
    );
    recentActivities.push(...cameraScans);
    
    // Get recent allergy scans
    const allergyScans = await db.all(
      'SELECT user_email, "allergy_scan" as activity_type, "Scanned product: " || product_name as description, timestamp as created_at FROM allergy_scans ORDER BY timestamp DESC LIMIT 5'
    );
    recentActivities.push(...allergyScans);
    
    // Get recent goal activities
    const goalActivities = await db.all(
      'SELECT user_email, CASE WHEN is_completed = 1 THEN "goal_completed" ELSE "goal_created" END as activity_type, CASE WHEN is_completed = 1 THEN "Completed goal: " || goal_type ELSE "Created goal: " || goal_type END as description, created_at FROM user_goals ORDER BY created_at DESC LIMIT 5'
    );
    recentActivities.push(...goalActivities);
    
    // Get recent achievements
    const achievements = await db.all(
      'SELECT user_email, "achievement_earned" as activity_type, "Earned: " || achievement_name as description, earned_at as created_at FROM user_achievements ORDER BY earned_at DESC LIMIT 5'
    );
    recentActivities.push(...achievements);
    
    // Get recent challenge activities
    const challengeActivities = await db.all(
      'SELECT user_email, "challenge_joined" as activity_type, "Joined challenge" as description, joined_at as created_at FROM challenge_participants ORDER BY joined_at DESC LIMIT 5'
    );
    recentActivities.push(...challengeActivities);
    
    // Get recent regular scans
    const regularScans = await db.all(
      'SELECT user_email, "scan" as activity_type, "Scanned: " || dessert_name as description, scanned_at as created_at FROM scans ORDER BY scanned_at DESC LIMIT 5'
    );
    recentActivities.push(...regularScans);
    
    // Sort all activities by timestamp and limit to 20
    const sortedActivities = recentActivities
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);
    
    res.json(sortedActivities);
  } catch (error) {
    console.error('Error fetching recent activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

app.get('/api/analytics/user-activity/:userEmail', async (req, res) => {
  try {
    const { userEmail } = req.params;
    
    // Get user's activity across all features
    const recentScans = await db.all(
      'SELECT * FROM scans WHERE user_email = ? ORDER BY scanned_at DESC LIMIT 10',
      [userEmail]
    );
    const smartCameraScans = await db.all(
      'SELECT * FROM smart_camera_scans WHERE user_email = ? ORDER BY timestamp DESC LIMIT 10',
      [userEmail]
    );
    const allergyScans = await db.all(
      'SELECT * FROM allergy_scans WHERE user_email = ? ORDER BY timestamp DESC LIMIT 10',
      [userEmail]
    );
    const aiChatMessages = await db.all(
      'SELECT * FROM ai_chat_messages WHERE user_email = ? ORDER BY timestamp DESC LIMIT 10',
      [userEmail]
    );
    const goals = await db.all(
      'SELECT * FROM user_goals WHERE user_email = ? ORDER BY created_at DESC',
      [userEmail]
    );
    const achievements = await db.all(
      'SELECT * FROM user_achievements WHERE user_email = ? ORDER BY earned_at DESC LIMIT 10',
      [userEmail]
    );
    
    res.json({
      recentScans,
      smartCameraScans,
      allergyScans,
      aiChatMessages,
      goals,
      achievements
    });
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({ error: 'Failed to fetch user activity' });
  }
});

// ========== ADVANCED ADMIN FEATURES API (12 Improvements) ==========

// 1. User Journey Funnel Analytics
app.get('/api/analytics/funnel', async (req, res) => {
  try {
    // Get counts for each stage of user journey
    const totalSignups = await db.get('SELECT COUNT(*) as count FROM users');
    const firstScan = await db.get('SELECT COUNT(DISTINCT user_email) as count FROM scans');
    const goalSet = await db.get('SELECT COUNT(DISTINCT user_email) as count FROM user_goals');
    const challengeJoined = await db.get('SELECT COUNT(DISTINCT user_email) as count FROM challenge_participants');
    const achievementEarned = await db.get('SELECT COUNT(DISTINCT user_email) as count FROM user_achievements');
    
    // Calculate conversion rates
    const funnel = {
      stages: [
        { name: 'Sign Up', count: totalSignups.count, conversionRate: 100 },
        { name: 'First Scan', count: firstScan.count, conversionRate: totalSignups.count > 0 ? ((firstScan.count / totalSignups.count) * 100).toFixed(2) : 0 },
        { name: 'Goal Set', count: goalSet.count, conversionRate: firstScan.count > 0 ? ((goalSet.count / firstScan.count) * 100).toFixed(2) : 0 },
        { name: 'Challenge Joined', count: challengeJoined.count, conversionRate: goalSet.count > 0 ? ((challengeJoined.count / goalSet.count) * 100).toFixed(2) : 0 },
        { name: 'Achievement Earned', count: achievementEarned.count, conversionRate: challengeJoined.count > 0 ? ((achievementEarned.count / challengeJoined.count) * 100).toFixed(2) : 0 }
      ]
    };
    
    res.json(funnel);
  } catch (error) {
    console.error('Error fetching funnel analytics:', error);
    res.status(500).json({ error: 'Failed to fetch funnel data' });
  }
});

// 2. User Retention Heatmap Data
app.get('/api/analytics/retention-heatmap', async (req, res) => {
  try {
    const days = req.query.days || 30;
    
    // Get daily active users for the past X days
    const heatmapData = await db.all(`
      SELECT 
        DATE(created_at) as date,
        COUNT(DISTINCT user_email) as active_users,
        SUM(activity_count) as total_activities
      FROM daily_active_users
      WHERE active_date >= DATE('now', '-${days} days')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);
    
    res.json(heatmapData);
  } catch (error) {
    console.error('Error fetching retention heatmap:', error);
    res.status(500).json({ error: 'Failed to fetch heatmap data' });
  }
});

// 3. Real-time Online Users
app.get('/api/analytics/online-users', async (req, res) => {
  try {
    // Clean up old sessions (inactive for > 5 minutes)
    await db.run(`
      DELETE FROM online_users 
      WHERE last_activity < datetime('now', '-5 minutes')
    `);
    
    // Get current online users count
    const onlineCount = await db.get('SELECT COUNT(DISTINCT user_email) as count FROM online_users');
    const totalSessions = await db.get('SELECT COUNT(*) as count FROM online_users');
    
    res.json({
      onlineUsers: onlineCount.count,
      activeSessions: totalSessions.count,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching online users:', error);
    res.status(500).json({ error: 'Failed to fetch online users' });
  }
});

// Heartbeat endpoint for online users tracking
app.post('/api/heartbeat', async (req, res) => {
  try {
    const { userEmail, sessionId } = req.body;
    
    // Upsert online user record
    await db.run(`
      INSERT INTO online_users (user_email, session_id, last_activity, ip_address)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(user_email, session_id) 
      DO UPDATE SET last_activity = CURRENT_TIMESTAMP
    `, [userEmail, sessionId, req.ip]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating heartbeat:', error);
    res.status(500).json({ error: 'Failed to update heartbeat' });
  }
});

// 4. Smart Alerts System
app.get('/api/alerts/rules', async (req, res) => {
  try {
    const rules = await db.all('SELECT * FROM alert_rules WHERE is_active = 1');
    res.json(rules);
  } catch (error) {
    console.error('Error fetching alert rules:', error);
    res.status(500).json({ error: 'Failed to fetch alert rules' });
  }
});

app.post('/api/alerts/rules', async (req, res) => {
  try {
    const { alertName, alertType, thresholdValue, comparisonOperator, emailNotifications } = req.body;
    
    const result = await db.run(`
      INSERT INTO alert_rules (alert_name, alert_type, threshold_value, comparison_operator, email_notifications)
      VALUES (?, ?, ?, ?, ?)
    `, [alertName, alertType, thresholdValue, comparisonOperator, emailNotifications]);
    
    res.json({ success: true, ruleId: result.lastID });
  } catch (error) {
    console.error('Error creating alert rule:', error);
    res.status(500).json({ error: 'Failed to create alert rule' });
  }
});

app.get('/api/alerts/history', async (req, res) => {
  try {
    const alerts = await db.all(`
      SELECT ah.*, ar.alert_name, ar.alert_type
      FROM alert_history ah
      JOIN alert_rules ar ON ah.alert_rule_id = ar.id
      ORDER BY ah.triggered_at DESC
      LIMIT 50
    `);
    res.json(alerts);
  } catch (error) {
    console.error('Error fetching alert history:', error);
    res.status(500).json({ error: 'Failed to fetch alert history' });
  }
});

// 5. Scheduled Reports
app.get('/api/reports/scheduled', async (req, res) => {
  try {
    const reports = await db.all('SELECT * FROM scheduled_reports ORDER BY created_at DESC');
    res.json(reports);
  } catch (error) {
    console.error('Error fetching scheduled reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

app.post('/api/reports/scheduled', async (req, res) => {
  try {
    const { reportName, frequency, emailRecipients } = req.body;
    
    const result = await db.run(`
      INSERT INTO scheduled_reports (report_name, frequency, email_recipients)
      VALUES (?, ?, ?)
    `, [reportName, frequency, emailRecipients]);
    
    res.json({ success: true, reportId: result.lastID });
  } catch (error) {
    console.error('Error creating scheduled report:', error);
    res.status(500).json({ error: 'Failed to create report' });
  }
});

// 6. Bulk Operations
app.post('/api/bulk/announcement', async (req, res) => {
  try {
    const { userEmails, message, title } = req.body;
    
    // In a real app, this would send notifications/emails
    // For now, log the bulk action
    await Promise.all(userEmails.map(email => 
      logActivity(email, 'bulk_announcement', `Received announcement: ${title}`)
    ));
    
    res.json({ success: true, recipientsCount: userEmails.length });
  } catch (error) {
    console.error('Error sending bulk announcement:', error);
    res.status(500).json({ error: 'Failed to send announcement' });
  }
});

app.post('/api/bulk/achievement', async (req, res) => {
  try {
    const { userEmails, achievementName, achievementType, points } = req.body;
    
    await Promise.all(userEmails.map(email => 
      db.run(`
        INSERT INTO user_achievements (user_email, achievement_type, achievement_name, points_awarded)
        VALUES (?, ?, ?, ?)
      `, [email, achievementType, achievementName, points])
    ));
    
    res.json({ success: true, recipientsCount: userEmails.length });
  } catch (error) {
    console.error('Error awarding bulk achievements:', error);
    res.status(500).json({ error: 'Failed to award achievements' });
  }
});

app.post('/api/bulk/export', async (req, res) => {
  try {
    const { userEmails } = req.body;
    
    // Get full user data for selected users
    const users = await db.all(`
      SELECT u.*, 
        (SELECT COUNT(*) FROM scans WHERE user_email = u.email) as scan_count,
        (SELECT COUNT(*) FROM user_goals WHERE user_email = u.email) as goal_count,
        (SELECT COUNT(*) FROM user_achievements WHERE user_email = u.email) as achievement_count
      FROM users u
      WHERE u.email IN (${userEmails.map(() => '?').join(',')})
    `, userEmails);
    
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Error exporting user data:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// 7. Content Management System (CMS)
app.get('/api/cms/content', async (req, res) => {
  try {
    const { type } = req.query;
    let sql = 'SELECT * FROM cms_content WHERE is_active = 1';
    const params = [];
    
    if (type) {
      sql += ' AND content_type = ?';
      params.push(type);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const content = await db.all(sql, params);
    res.json(content);
  } catch (error) {
    console.error('Error fetching CMS content:', error);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

app.post('/api/cms/content', async (req, res) => {
  try {
    const { contentType, title, content, metadata, createdBy } = req.body;
    
    const result = await db.run(`
      INSERT INTO cms_content (content_type, title, content, metadata, created_by)
      VALUES (?, ?, ?, ?, ?)
    `, [contentType, title, content, JSON.stringify(metadata), createdBy]);
    
    res.json({ success: true, contentId: result.lastID });
  } catch (error) {
    console.error('Error creating CMS content:', error);
    res.status(500).json({ error: 'Failed to create content' });
  }
});

app.put('/api/cms/content/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, metadata, updatedBy } = req.body;
    
    await db.run(`
      UPDATE cms_content 
      SET title = ?, content = ?, metadata = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [title, content, JSON.stringify(metadata), updatedBy, id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating CMS content:', error);
    res.status(500).json({ error: 'Failed to update content' });
  }
});

// 8. User Impersonation
app.post('/api/admin/impersonate', async (req, res) => {
  try {
    const { adminEmail, targetUserEmail, action } = req.body;
    
    // Log impersonation action
    await db.run(`
      INSERT INTO user_impersonation_logs (admin_email, target_user_email, action, ip_address)
      VALUES (?, ?, ?, ?)
    `, [adminEmail, targetUserEmail, action, req.ip]);
    
    // Get target user data for impersonation
    const targetUser = await db.get('SELECT * FROM users WHERE email = ?', [targetUserEmail]);
    
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ 
      success: true, 
      user: {
        email: targetUser.email,
        name: targetUser.name,
        username: targetUser.username,
        role: targetUser.role
      }
    });
  } catch (error) {
    console.error('Error impersonating user:', error);
    res.status(500).json({ error: 'Failed to impersonate user' });
  }
});

app.get('/api/admin/impersonation-logs', async (req, res) => {
  try {
    const logs = await db.all(`
      SELECT * FROM user_impersonation_logs
      ORDER BY created_at DESC
      LIMIT 50
    `);
    res.json(logs);
  } catch (error) {
    console.error('Error fetching impersonation logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// 9. A/B Testing
app.get('/api/ab-tests', async (req, res) => {
  try {
    const tests = await db.all('SELECT * FROM ab_tests ORDER BY created_at DESC');
    res.json(tests);
  } catch (error) {
    console.error('Error fetching A/B tests:', error);
    res.status(500).json({ error: 'Failed to fetch tests' });
  }
});

app.post('/api/ab-tests', async (req, res) => {
  try {
    const { testName, variantAName, variantBName, startDate, endDate } = req.body;
    
    const result = await db.run(`
      INSERT INTO ab_tests (test_name, variant_a_name, variant_b_name, start_date, end_date)
      VALUES (?, ?, ?, ?, ?)
    `, [testName, variantAName, variantBName, startDate, endDate]);
    
    res.json({ success: true, testId: result.lastID });
  } catch (error) {
    console.error('Error creating A/B test:', error);
    res.status(500).json({ error: 'Failed to create test' });
  }
});

app.get('/api/ab-tests/:id/results', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get variant distribution
    const variantStats = await db.all(`
      SELECT 
        variant,
        COUNT(*) as total_users,
        SUM(CASE WHEN converted = 1 THEN 1 ELSE 0 END) as conversions,
        (SUM(CASE WHEN converted = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as conversion_rate
      FROM ab_test_results
      WHERE test_id = ?
      GROUP BY variant
    `, [id]);
    
    res.json({ testId: id, variants: variantStats });
  } catch (error) {
    console.error('Error fetching A/B test results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// 10. Revenue Tracking
app.get('/api/revenue/overview', async (req, res) => {
  try {
    const totalRevenue = await db.get('SELECT SUM(amount) as total FROM revenue_tracking');
    const monthlyRevenue = await db.all(`
      SELECT 
        strftime('%Y-%m', transaction_date) as month,
        SUM(amount) as revenue,
        COUNT(*) as transactions
      FROM revenue_tracking
      GROUP BY strftime('%Y-%m', transaction_date)
      ORDER BY month DESC
      LIMIT 12
    `);
    
    res.json({
      totalRevenue: totalRevenue.total || 0,
      monthlyBreakdown: monthlyRevenue
    });
  } catch (error) {
    console.error('Error fetching revenue data:', error);
    res.status(500).json({ error: 'Failed to fetch revenue' });
  }
});

app.post('/api/revenue/track', async (req, res) => {
  try {
    const { userEmail, transactionType, amount, currency, description } = req.body;
    
    const result = await db.run(`
      INSERT INTO revenue_tracking (user_email, transaction_type, amount, currency, description)
      VALUES (?, ?, ?, ?, ?)
    `, [userEmail, transactionType, amount, currency, description]);
    
    res.json({ success: true, transactionId: result.lastID });
  } catch (error) {
    console.error('Error tracking revenue:', error);
    res.status(500).json({ error: 'Failed to track revenue' });
  }
});

// 11. Integration Health Monitoring
app.get('/api/integrations/health', async (req, res) => {
  try {
    const services = await db.all('SELECT * FROM integration_health ORDER BY last_checked DESC');
    
    // Calculate overall health score
    const criticalServices = services.filter(s => s.is_critical);
    const healthyCritical = criticalServices.filter(s => s.status === 'healthy').length;
    const healthScore = criticalServices.length > 0 
      ? (healthyCritical / criticalServices.length) * 100 
      : 100;
    
    res.json({
      overallHealth: healthScore.toFixed(2),
      services: services
    });
  } catch (error) {
    console.error('Error fetching integration health:', error);
    res.status(500).json({ error: 'Failed to fetch health status' });
  }
});

app.post('/api/integrations/health-check', async (req, res) => {
  try {
    const { serviceName, serviceType, status, responseTimeMs, errorMessage, isCritical } = req.body;
    
    await db.run(`
      INSERT INTO integration_health (service_name, service_type, status, response_time_ms, error_message, is_critical)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(service_name) 
      DO UPDATE SET 
        status = ?,
        response_time_ms = ?,
        error_message = ?,
        last_checked = CURRENT_TIMESTAMP
    `, [serviceName, serviceType, status, responseTimeMs, errorMessage, isCritical, status, responseTimeMs, errorMessage]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating health check:', error);
    res.status(500).json({ error: 'Failed to update health check' });
  }
});

// 12. Export Scheduler
app.get('/api/exports/schedules', async (req, res) => {
  try {
    const schedules = await db.all('SELECT * FROM export_schedules ORDER BY created_at DESC');
    res.json(schedules);
  } catch (error) {
    console.error('Error fetching export schedules:', error);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

app.post('/api/exports/schedules', async (req, res) => {
  try {
    const { exportName, exportType, frequency, destination, emailRecipients } = req.body;
    
    const result = await db.run(`
      INSERT INTO export_schedules (export_name, export_type, frequency, destination, email_recipients)
      VALUES (?, ?, ?, ?, ?)
    `, [exportName, exportType, frequency, destination, emailRecipients]);
    
    res.json({ success: true, scheduleId: result.lastID });
  } catch (error) {
    console.error('Error creating export schedule:', error);
    res.status(500).json({ error: 'Failed to create schedule' });
  }
});

// Serve static files (MUST be at the end after all API routes)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Handle the /admin route explicitly
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Catch-all for admin sub-routes (SPA support)
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
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
