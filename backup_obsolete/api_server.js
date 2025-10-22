const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.API_PORT || 3000;
const HOST = process.env.API_HOST || 'localhost';
const DB_PATH = process.env.DB_PATH || './charges.db';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

// Database connection helper
function getDbConnection() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(db);
      }
    });
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Get latest records
app.get('/latest', async (req, res) => {
  try {
    const { category, limit = 50, offset = 0 } = req.query;
    
    const db = await getDbConnection();
    
    let sql = `
      SELECT 
        id, captured_at, source_page, dom_path, context_text,
        raw_value, data_category, data_type, numeric_value,
        unit, parsed_ts, confidence_score, metadata, created_at
      FROM captured_data
    `;
    
    const params = [];
    
    if (category) {
      sql += ' WHERE data_category = ?';
      params.push(category);
    }
    
    sql += ' ORDER BY captured_at DESC, id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    db.all(sql, params, (err, rows) => {
      db.close();
      
      if (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Database error', message: err.message });
        return;
      }
      
      // Parse metadata JSON
      const processedRows = rows.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
      }));
      
      res.json({
        success: true,
        data: processedRows,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          returned: processedRows.length
        },
        filters: {
          category: category || null
        }
      });
    });
    
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Get categories summary
app.get('/categories', async (req, res) => {
  try {
    const db = await getDbConnection();
    
    const sql = `
      SELECT 
        data_category,
        COUNT(*) as record_count,
        AVG(confidence_score) as avg_confidence,
        MIN(captured_at) as first_seen,
        MAX(captured_at) as last_seen,
        COUNT(DISTINCT source_page) as page_count
      FROM captured_data 
      GROUP BY data_category 
      ORDER BY record_count DESC
    `;
    
    db.all(sql, [], (err, rows) => {
      db.close();
      
      if (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Database error', message: err.message });
        return;
      }
      
      res.json({
        success: true,
        data: rows,
        summary: {
          total_categories: rows.length,
          total_records: rows.reduce((sum, row) => sum + row.record_count, 0)
        }
      });
    });
    
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Get records by date range
app.get('/range', async (req, res) => {
  try {
    const { start, end, category, limit = 100 } = req.query;
    
    if (!start || !end) {
      res.status(400).json({ 
        error: 'Bad request', 
        message: 'Both start and end dates are required (ISO format)' 
      });
      return;
    }
    
    const db = await getDbConnection();
    
    let sql = `
      SELECT 
        id, captured_at, source_page, dom_path, context_text,
        raw_value, data_category, data_type, numeric_value,
        unit, parsed_ts, confidence_score, metadata, created_at
      FROM captured_data
      WHERE captured_at >= ? AND captured_at <= ?
    `;
    
    const params = [start, end];
    
    if (category) {
      sql += ' AND data_category = ?';
      params.push(category);
    }
    
    sql += ' ORDER BY captured_at ASC, id ASC LIMIT ?';
    params.push(parseInt(limit));
    
    db.all(sql, params, (err, rows) => {
      db.close();
      
      if (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Database error', message: err.message });
        return;
      }
      
      // Parse metadata JSON
      const processedRows = rows.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
      }));
      
      res.json({
        success: true,
        data: processedRows,
        filters: {
          start_date: start,
          end_date: end,
          category: category || null
        },
        summary: {
          returned: processedRows.length,
          limit: parseInt(limit)
        }
      });
    });
    
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Get statistics
app.get('/stats', async (req, res) => {
  try {
    const db = await getDbConnection();
    
    // Get overall statistics
    const statsPromises = [
      // Total records
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as total FROM captured_data', (err, row) => {
          if (err) reject(err);
          else resolve({ total_records: row.total });
        });
      }),
      
      // Date range
      new Promise((resolve, reject) => {
        db.get('SELECT MIN(captured_at) as first, MAX(captured_at) as last FROM captured_data', (err, row) => {
          if (err) reject(err);
          else resolve({ first_capture: row.first, last_capture: row.last });
        });
      }),
      
      // Unique pages
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(DISTINCT source_page) as pages FROM captured_data', (err, row) => {
          if (err) reject(err);
          else resolve({ unique_pages: row.pages });
        });
      }),
      
      // Data types breakdown
      new Promise((resolve, reject) => {
        db.all('SELECT data_type, COUNT(*) as count FROM captured_data GROUP BY data_type', (err, rows) => {
          if (err) reject(err);
          else resolve({ data_types: rows });
        });
      })
    ];
    
    const results = await Promise.all(statsPromises);
    db.close();
    
    const stats = Object.assign({}, ...results);
    
    res.json({
      success: true,
      statistics: stats,
      generated_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Search records by text
app.get('/search', async (req, res) => {
  try {
    const { q, category, limit = 50 } = req.query;
    
    if (!q) {
      res.status(400).json({ 
        error: 'Bad request', 
        message: 'Search query (q) parameter is required' 
      });
      return;
    }
    
    const db = await getDbConnection();
    
    let sql = `
      SELECT 
        id, captured_at, source_page, dom_path, context_text,
        raw_value, data_category, data_type, numeric_value,
        unit, parsed_ts, confidence_score, metadata, created_at
      FROM captured_data
      WHERE (context_text LIKE ? OR raw_value LIKE ?)
    `;
    
    const searchPattern = `%${q}%`;
    const params = [searchPattern, searchPattern];
    
    if (category) {
      sql += ' AND data_category = ?';
      params.push(category);
    }
    
    sql += ' ORDER BY captured_at DESC, id DESC LIMIT ?';
    params.push(parseInt(limit));
    
    db.all(sql, params, (err, rows) => {
      db.close();
      
      if (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Database error', message: err.message });
        return;
      }
      
      // Parse metadata JSON
      const processedRows = rows.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
      }));
      
      res.json({
        success: true,
        data: processedRows,
        search: {
          query: q,
          category: category || null,
          results_count: processedRows.length,
          limit: parseInt(limit)
        }
      });
    });
    
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// API documentation endpoint
app.get('/', (req, res) => {
  const documentation = {
    name: 'UPPCL Auto Scraper API',
    version: '1.0.0',
    description: 'REST API for accessing scraped UPPCL data',
    endpoints: {
      'GET /health': 'Health check',
      'GET /latest': 'Get latest records (params: category, limit, offset)',
      'GET /categories': 'Get categories summary',
      'GET /range': 'Get records by date range (params: start, end, category, limit)',
      'GET /stats': 'Get overall statistics',
      'GET /search': 'Search records by text (params: q, category, limit)',
      'GET /': 'This documentation'
    },
    examples: {
      latest: '/latest?category=dg_charge&limit=20',
      range: '/range?start=2024-01-01&end=2024-01-31&category=units_consumed',
      search: '/search?q=voltage&limit=10'
    }
  };
  
  res.json(documentation);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: err.message 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found', 
    message: 'Endpoint not found. Visit / for API documentation.' 
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`🚀 UPPCL API Server running on http://${HOST}:${PORT}`);
  console.log(`📖 API Documentation: http://${HOST}:${PORT}/`);
  console.log(`🔍 Health Check: http://${HOST}:${PORT}/health`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

module.exports = app;