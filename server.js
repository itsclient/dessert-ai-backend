const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Initialize SQLite database
const db = new sqlite3.Database('./dessert_ai_admin.db');

// Create tables
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

  // Seed admin account
  const adminPassword = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT OR IGNORE INTO users (email, username, name, password, role) VALUES (?, ?, ?, ?, ?)`,
    ['admin@gmail.com', 'Admin', 'NutriVision Admin', adminPassword, 'admin']);
});

// Activity deduplication cache (userEmail + type -> last timestamp)
const activityCache = new Map();
const ACTIVITY_DEDUP_WINDOW = 5000; // 5 seconds

// Helper: log activity (with duplicate prevention)
function logActivity(userEmail, type, description) {
  const key = `${userEmail}:${type}`;
  const now = Date.now();
  const lastLogged = activityCache.get(key);

  // Skip if same activity was logged within 5 seconds
  if (lastLogged && (now - lastLogged) < ACTIVITY_DEDUP_WINDOW) {
    return;
  }

  activityCache.set(key, now);

  // Clean old cache entries every 100 logs
  if (activityCache.size > 100) {
    const cutoff = now - ACTIVITY_DEDUP_WINDOW;
    for (const [k, v] of activityCache.entries()) {
      if (v < cutoff) activityCache.delete(k);
    }
  }

  db.run('INSERT INTO activities (user_email, activity_type, description) VALUES (?, ?, ?)',
    [userEmail, type, description], (err) => {
      if (err) console.error('Activity log error:', err);
    });
}

// ===================== API ROUTES =====================

// Sync user data from mobile app
app.post('/api/sync', (req, res) => {
  const { user, scans } = req.body;

  if (!user || !user.email) {
    return res.status(400).json({ error: 'User data required' });
  }

  console.log('SYNC: Received sync request for user:', user.email);
  console.log('SYNC: Scans to sync:', scans?.length || 0);

  try {
    // Upsert user
    db.get('SELECT id FROM users WHERE email = ?', [user.email], (err, row) => {
      if (err) {
        console.error('Error checking user:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (!row) {
        // Create new user
        db.run(`
          INSERT INTO users (email, username, name, password, role)
          VALUES (?, ?, ?, ?, 'user')
        `, [user.email, user.username, user.name, user.password], (err) => {
          if (err) {
            console.error('SYNC: User creation failed:', err);
            return res.status(500).json({ error: 'User creation failed' });
          }
          console.log('SYNC: Created new user:', user.email);
          processScans();
        });
      } else {
        console.log('SYNC: User exists:', user.email);
        processScans();
      }
    });

    function processScans() {
      // Insert scans - check for duplicates before inserting
      if (scans && scans.length > 0) {
        let processedCount = 0;
        let newCount = 0;
        let validScans = scans.filter(scan => {
          const dessertName = scan.dessert_name || scan.dessert || 'Unknown Dessert';
          return dessertName && dessertName.trim() !== '';
        });

        if (validScans.length === 0) {
          console.log('SYNC: No valid scans to process');
          res.json({ success: true, message: 'No valid scans to sync' });
          return;
        }
        
        validScans.forEach((scan, index) => {
          const scanDate = scan.timestamp || scan.scanned_at || new Date().toISOString();
          const dessertName = scan.dessert_name || scan.dessert || 'Unknown Dessert';
          
          // Check if this scan already exists (same user, dessert, calories, and timestamp)
          db.get(
            `SELECT id FROM scans WHERE user_email = ? AND dessert_name = ? AND calories = ? AND scanned_at = ?`,
            [user.email, dessertName, scan.calories || 0, scanDate],
            (err, existingScan) => {
              if (err) {
                console.error('SYNC: Scan check error:', err);
                processedCount++;
              } else if (existingScan) {
                // Scan already exists, skip it
                console.log('SYNC: Scan already exists, skipping:', dessertName);
                processedCount++;
              } else {
                // New scan, insert it
                db.run(`
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
                ], (err) => {
                  if (err) {
                    console.error('SYNC: Scan insert error:', err);
                  } else {
                    newCount++;
                    // Log activity only for new scans
                    logActivity(user.email, 'scan', `Scanned: ${dessertName} (${scan.calories} cal)`);
                  }
                  processedCount++;
                  
                  // Send response after all scans are processed
                  if (processedCount === validScans.length) {
                    console.log('SYNC: Synced', newCount, 'new scans (skipped', validScans.length - newCount, 'duplicates)');
                    res.json({ success: true, message: `Synced ${newCount} new scans` });
                    if (newCount > 0) {
                      logActivity(user.email, 'sync', `Synced ${newCount} new scans`);
                    }
                  }
                });
              }
              
              // Check if all scans have been processed (for the skip case)
              if (existingScan && processedCount === validScans.length) {
                console.log('SYNC: All scans were duplicates, no new scans added');
                res.json({ success: true, message: 'All scans already synced' });
              }
            }
          );
        });
      } else {
        console.log('SYNC: No scans to process');
        res.json({ success: true, message: 'No scans to sync' });
      }
    }
  } catch (error) {
    console.error('SYNC: Sync error:', error);
    res.status(500).json({ error: 'Sync failed: ' + error.message });
  }
});

// User registration
app.post('/api/register', (req, res) => {
  const { email, username, name, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  // Check if user already exists
  db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (row) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Create new user
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.run(
      'INSERT INTO users (email, username, name, password, role) VALUES (?, ?, ?, ?, ?)',
      [email, username || null, name || null, hashedPassword, 'user'],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to create user' });
        }
        logActivity(email, 'register', `New user registered: ${username || email}`);
        res.status(201).json({ success: true, message: 'User created successfully' });
      }
    );
  });
});

// User login (by email)
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  db.get('SELECT * FROM users WHERE email = ? AND role = ?', [email, 'user'], (err, user) => {
    if (err || !user) {
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
  });
});

// User login (by username)
app.post('/api/login-username', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  db.get('SELECT * FROM users WHERE username = ? AND role = ?', [username, 'user'], (err, user) => {
    if (err || !user) {
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
  });
});

// Update user profile
app.put('/api/user/profile', (req, res) => {
  const { email, username, name } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  db.run('UPDATE users SET username = ?, name = ? WHERE email = ?',
    [username || null, name || null, email],
    (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      logActivity(email, 'profile_update', `Profile updated: ${username || email}`);
      res.json({ success: true, message: 'Profile updated' });
    }
  );
});

// Change user password
app.put('/api/user/password', (req, res) => {
  const { email, current_password, new_password } = req.body;

  if (!email || !current_password || !new_password) {
    return res.status(400).json({ error: 'All fields required' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!bcrypt.compareSync(current_password, user.password)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedNewPassword = bcrypt.hashSync(new_password, 10);
    db.run('UPDATE users SET password = ? WHERE email = ?',
      [hashedNewPassword, email],
      (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        logActivity(email, 'password_change', 'Password changed');
        res.json({ success: true, message: 'Password updated' });
      }
    );
  });
});

// Check if user exists
app.get('/api/user/check/:email', (req, res) => {
  const { email } = req.params;
  
  db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ exists: !!row });
  });
});

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;

  db.get('SELECT * FROM users WHERE email = ? AND role = ?', [email, 'admin'], (err, user) => {
    if (err || !user) {
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
  });
});

// Get all users (admin only)
app.get('/api/admin/users', (req, res) => {
  db.all('SELECT id, email, username, name, role, created_at FROM users WHERE role = ?', ['user'], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ users: rows });
  });
});

// Get all scans (admin only)
app.get('/api/admin/scans', (req, res) => {
  db.all(`
    SELECT s.*, u.username, u.name 
    FROM scans s 
    LEFT JOIN users u ON s.user_email = u.email 
    ORDER BY s.scanned_at DESC
  `, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ scans: rows });
  });
});

// Get dashboard stats
app.get('/api/admin/stats', (req, res) => {
  db.get('SELECT COUNT(*) as total_users FROM users WHERE role = ?', ['user'], (err, userCount) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    db.get('SELECT COUNT(*) as total_scans FROM scans', (err, scanCount) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      db.get('SELECT AVG(calories) as avg_calories FROM scans', (err, avgCals) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        db.all(`
          SELECT category, COUNT(*) as count 
          FROM scans 
          GROUP BY category 
          ORDER BY count DESC 
          LIMIT 5
        `, (err, categories) => {
          if (err) return res.status(500).json({ error: 'Database error' });

          db.all(`
            SELECT date(scanned_at) as date, COUNT(*) as scan_count, SUM(calories) as total_calories
            FROM scans
            GROUP BY date(scanned_at)
            ORDER BY date DESC
            LIMIT 30
          `, (err, dailyStats) => {
            if (err) return res.status(500).json({ error: 'Database error' });

            res.json({
              total_users: userCount.total_users,
              total_scans: scanCount.total_scans,
              avg_calories: Math.round(avgCals.avg_calories || 0),
              top_categories: categories,
              daily_stats: dailyStats
            });
          });
        });
      });
    });
  });
});

// Delete user (admin only)
app.delete('/api/admin/users/:email', (req, res) => {
  const email = req.params.email;

  db.run('DELETE FROM scans WHERE user_email = ?', [email], (err) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    db.run('DELETE FROM activities WHERE user_email = ?', [email], (err) => {
      if (err) console.error('Error deleting activities:', err);

      db.run('DELETE FROM users WHERE email = ? AND role = ?', [email, 'user'], (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        res.json({ success: true, message: 'User deleted' });
      });
    });
  });
});

// Get all activities (admin only)
app.get('/api/admin/activities', (req, res) => {
  db.all(`
    SELECT a.*, u.username, u.name 
    FROM activities a 
    LEFT JOIN users u ON a.user_email = u.email 
    ORDER BY a.created_at DESC
    LIMIT 100
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ activities: rows });
  });
});

// Main Analytics Dashboard
app.get('/api/admin/analytics', (req, res) => {
  const queries = {
    // Total users
    totalUsers: `SELECT COUNT(*) as count FROM users WHERE role = 'user'`,
    
    // Total scans
    totalScans: `SELECT COUNT(*) as count FROM scans`,
    
    // Total calories
    totalCalories: `SELECT SUM(calories) as total FROM scans`,
    
    // Average calories per scan
    avgCalories: `SELECT AVG(calories) as avg FROM scans`,
    
    // Scans today
    scansToday: `SELECT COUNT(*) as count FROM scans WHERE DATE(scanned_at) = DATE('now')`,
    
    // Calories today
    caloriesToday: `SELECT SUM(calories) as total FROM scans WHERE DATE(scanned_at) = DATE('now')`
  };

  const results = {};
  let completed = 0;
  const total = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    db.get(query, (err, row) => {
      if (err) {
        console.error(`Analytics query error (${key}):`, err);
        results[key] = 0;
      } else {
        results[key] = row ? (row.count || row.total || row.avg || 0) : 0;
      }
      
      completed++;
      if (completed === total) {
        res.json(results);
      }
    });
  });
});

// User Analytics Dashboard
app.get('/api/admin/analytics/users', (req, res) => {
  const queries = {
    // User growth over time
    growth: `SELECT DATE(created_at) as date, COUNT(*) as new_users 
             FROM users WHERE role = 'user' 
             GROUP BY DATE(created_at) 
             ORDER BY date DESC LIMIT 30`,
    
    // Most active users
    leaderboard: `SELECT u.email, u.username, u.name, COUNT(s.id) as scan_count
                  FROM users u LEFT JOIN scans s ON u.email = s.user_email
                  WHERE u.role = 'user'
                  GROUP BY u.email, u.username, u.name
                  ORDER BY scan_count DESC LIMIT 10`,
    
    // User retention
    retention: `SELECT 
                  COUNT(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 END) as new_users,
                  COUNT(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 END) as monthly_users,
                  COUNT(*) as total_users
                FROM users WHERE role = 'user'`,
    
    // Average scans per user
    avgScans: `SELECT AVG(scan_count) as avg_scans
              FROM (
                SELECT COUNT(s.id) as scan_count
                FROM users u LEFT JOIN scans s ON u.email = s.user_email
                WHERE u.role = 'user'
                GROUP BY u.email
              )`
  };

  const results = {};
  let completed = 0;
  const totalQueries = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    db.all(query, (err, rows) => {
      if (err) {
        console.error(`Analytics query error (${key}):`, err);
        results[key] = [];
      } else {
        results[key] = rows;
      }
      
      if (++completed === totalQueries) {
        res.json(results);
      }
    });
  });
});

// Real-time alerts data
app.get('/api/admin/alerts', (req, res) => {
  const alerts = [];
  
  // Check for new users in last hour
  db.get(`SELECT COUNT(*) as count FROM users WHERE created_at >= datetime('now', '-1 hour') AND role = 'user'`, (err, row) => {
    if (!err && row.count > 0) {
      alerts.push({
        type: 'new_users',
        message: `${row.count} new user(s) in the last hour`,
        level: 'info',
        count: row.count
      });
    }
    
    // Check for high-calorie scans
    db.get(`SELECT COUNT(*) as count FROM scans WHERE calories > 800 AND scanned_at >= datetime('now', '-2 hours')`, (err, row) => {
      if (!err && row.count > 0) {
        alerts.push({
          type: 'high_calories',
          message: `${row.count} high-calorie scans detected (>800 cal)`,
          level: 'warning',
          count: row.count
        });
      }
      
      // Check system health
      const uptime = process.uptime();
      const memoryUsage = process.memoryUsage();
      
      if (memoryUsage.heapUsed / 1024 / 1024 > 100) {
        alerts.push({
          type: 'memory',
          message: `High memory usage: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
          level: 'error'
        });
      }
      
      res.json(alerts);
    });
  });
});

// Mobile app integration endpoints
app.get('/api/admin/mobile/stats', (req, res) => {
  // Get actual device stats from database
  db.get(`SELECT COUNT(DISTINCT email) as total_devices FROM users WHERE role = 'user'`, (err, row) => {
    const totalDevices = row ? row.total_devices : 0;
    
    // Get active devices (users who synced in last 24 hours)
    db.get(`SELECT COUNT(DISTINCT user_email) as active_devices FROM scans WHERE scanned_at >= datetime('now', '-24 hours')`, (err, row) => {
      const activeDevices = row ? row.active_devices : 0;
      
      res.json({
        app_version: '2.0.0',
        total_devices: totalDevices,
        active_devices: activeDevices,
        crash_reports: 0,
        push_notifications_sent: 0
      });
    });
  });
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
app.get('/api/admin/segments', (req, res) => {
  const segments = {};
  
  // Active users (have scanned in last 7 days)
  db.all(`SELECT u.email, u.username, u.name, COUNT(s.id) as scan_count, MAX(s.scanned_at) as last_scan
          FROM users u LEFT JOIN scans s ON u.email = s.user_email
          WHERE u.role = 'user'
          GROUP BY u.email, u.username, u.name
          HAVING last_scan IS NOT NULL AND last_scan >= datetime('now', '-7 days')`, (err, activeUsers) => {
    
    // Inactive users (no activity in 7 days or no scans at all)
    db.all(`SELECT u.email, u.username, u.name, COUNT(s.id) as scan_count, MAX(s.scanned_at) as last_scan
            FROM users u LEFT JOIN scans s ON u.email = s.user_email
            WHERE u.role = 'user'
            GROUP BY u.email, u.username, u.name
            HAVING last_scan IS NULL OR last_scan < datetime('now', '-7 days')`, (err, inactiveUsers) => {
      
      res.json({
        active: activeUsers,
        inactive: inactiveUsers
      });
    });
  });
});

// Advanced analytics
app.get('/api/admin/analytics/advanced', (req, res) => {
  const analytics = {};
  
  // Trend analysis - scans per day
  db.all(`SELECT DATE(scanned_at) as date, COUNT(*) as scans
          FROM scans 
          WHERE scanned_at >= datetime('now', '-30 days')
          GROUP BY DATE(scanned_at)
          ORDER BY date`, (err, trends) => {
    
    // Category correlations
    db.all(`SELECT category, AVG(calories) as avg_calories, COUNT(*) as count
            FROM scans 
            WHERE category IS NOT NULL
            GROUP BY category
            ORDER BY count DESC`, (err, correlations) => {
      
      // Seasonal patterns (hourly distribution)
      db.all(`SELECT strftime('%H', scanned_at) as hour, COUNT(*) as count
              FROM scans 
              WHERE scanned_at >= datetime('now', '-7 days')
              GROUP BY hour
              ORDER BY hour`, (err, seasonal) => {
        
        res.json({
          trends: trends,
          correlations: correlations,
          seasonal: seasonal
        });
      });
    });
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`NutriVision Admin API running on http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}`);
});

module.exports = app;
