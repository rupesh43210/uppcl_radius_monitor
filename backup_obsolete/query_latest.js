#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './charges.db';

// Parse command line arguments
const args = process.argv.slice(2);
const limit = args.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '50';
const category = args.find(arg => arg.startsWith('--category='))?.split('=')[1];
const showHelp = args.includes('--help') || args.includes('-h');

if (showHelp) {
  console.log(`
📊 Query Latest Captured Data

Usage: node query_latest.js [options]

Options:
  --limit=N           Number of records to show (default: 50)
  --category=NAME     Filter by data category (e.g., dg_charge, grid_status)
  --help, -h          Show this help message

Examples:
  node query_latest.js --limit=100
  node query_latest.js --category=dg_charge --limit=20
  node query_latest.js --category=units_consumed
`);
  process.exit(0);
}

function formatTimestamp(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleString();
}

function formatValue(value, unit, dataType) {
  if (value === null || value === undefined) return 'N/A';
  
  if (dataType === 'currency' && unit) {
    return `${unit}${value.toLocaleString()}`;
  }
  
  if (unit && dataType !== 'currency') {
    return `${value} ${unit}`;
  }
  
  if (dataType === 'percentage') {
    return `${value}%`;
  }
  
  return value.toString();
}

function truncateText(text, maxLength = 50) {
  if (!text) return 'N/A';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

async function queryLatest() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        console.error('❌ Error opening database:', err.message);
        console.error('💡 Make sure the scraper has run at least once to create the database.');
        reject(err);
        return;
      }

      let sql = `
        SELECT 
          id, captured_at, source_page, dom_path, context_text, 
          raw_value, data_category, data_type, numeric_value, 
          unit, parsed_ts, confidence_score, created_at
        FROM captured_data
      `;
      
      const params = [];
      
      if (category) {
        sql += ' WHERE data_category = ?';
        params.push(category);
      }
      
      sql += ' ORDER BY captured_at DESC, id DESC LIMIT ?';
      params.push(parseInt(limit));

      db.all(sql, params, (err, rows) => {
        db.close();
        
        if (err) {
          reject(err);
          return;
        }
        
        if (rows.length === 0) {
          console.log('📭 No records found.');
          if (category) {
            console.log(`💡 Try running without --category filter or check available categories with: node list_categories.js`);
          } else {
            console.log('💡 Make sure the scraper has run at least once to capture data.');
          }
          resolve();
          return;
        }

        console.log(`\n📊 Latest ${rows.length} Records${category ? ` (Category: ${category})` : ''}`);
        console.log('=' .repeat(120));
        
        console.log(`${'ID'.padEnd(6)} ${'Captured At'.padEnd(20)} ${'Category'.padEnd(18)} ${'Raw Value'.padEnd(25)} ${'Type'.padEnd(12)} ${'Context'.padEnd(30)}`);
        console.log('-'.repeat(120));
        
        rows.forEach(row => {
          const formattedValue = formatValue(row.numeric_value || row.raw_value, row.unit, row.data_type);
          const confidence = row.confidence_score ? `(${(row.confidence_score * 100).toFixed(0)}%)` : '';
          
          console.log(
            `${row.id.toString().padEnd(6)} ` +
            `${formatTimestamp(row.captured_at).substring(0, 19).padEnd(20)} ` +
            `${(row.data_category + confidence).padEnd(18)} ` +
            `${truncateText(formattedValue, 24).padEnd(25)} ` +
            `${row.data_type.padEnd(12)} ` +
            `${truncateText(row.context_text, 29).padEnd(30)}`
          );
        });
        
        console.log('-'.repeat(120));
        console.log(`\n📈 Summary:`);
        console.log(`Total records shown: ${rows.length}`);
        console.log(`Latest capture: ${formatTimestamp(rows[0]?.captured_at)}`);
        console.log(`Oldest in this view: ${formatTimestamp(rows[rows.length - 1]?.captured_at)}`);
        
        // Show category breakdown
        const categoryCount = {};
        rows.forEach(row => {
          categoryCount[row.data_category] = (categoryCount[row.data_category] || 0) + 1;
        });
        
        console.log(`\n🏷️  Categories in this view:`);
        Object.entries(categoryCount)
          .sort(([,a], [,b]) => b - a)
          .forEach(([cat, count]) => {
            console.log(`  ${cat}: ${count} records`);
          });
        
        console.log(`\n💡 Tips:`);
        console.log(`  • Use --category=NAME to filter by specific category`);
        console.log(`  • Use --limit=N to show more/fewer records`);
        console.log(`  • Run 'node list_categories.js' to see all available categories`);
        console.log(`  • Run 'node export_csv.js --category=NAME' to export data`);
        
        resolve();
      });
    });
  });
}

// Main execution
queryLatest().catch(err => {
  console.error('❌ Query failed:', err.message);
  process.exit(1);
});