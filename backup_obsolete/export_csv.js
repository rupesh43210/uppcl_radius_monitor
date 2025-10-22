#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './charges.db';

// Parse command line arguments
const args = process.argv.slice(2);
const category = args.find(arg => arg.startsWith('--category='))?.split('=')[1];
const startDate = args.find(arg => arg.startsWith('--start='))?.split('=')[1];
const endDate = args.find(arg => arg.startsWith('--end='))?.split('=')[1];
const output = args.find(arg => arg.startsWith('--output='))?.split('=')[1];
const showHelp = args.includes('--help') || args.includes('-h');

if (showHelp) {
  console.log(`
📤 Export Data to CSV

Usage: node export_csv.js [options]

Options:
  --category=NAME     Export specific data category (required)
  --start=DATE        Start date (ISO format: 2024-01-01 or 2024-01-01T10:00:00)
  --end=DATE          End date (ISO format: 2024-01-31 or 2024-01-31T23:59:59)
  --output=FILE       Output filename (default: auto-generated)
  --help, -h          Show this help message

Examples:
  node export_csv.js --category=dg_charge
  node export_csv.js --category=units_consumed --start=2024-01-01 --end=2024-01-31
  node export_csv.js --category=grid_status --output=grid_data.csv
  
Available categories can be found with: node list_categories.js
`);
  process.exit(0);
}

if (!category) {
  console.error('❌ Category is required. Use --category=NAME');
  console.error('💡 Run "node list_categories.js" to see available categories');
  process.exit(1);
}

function formatTimestamp(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toISOString();
}

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  
  const str = value.toString();
  
  // If the value contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  
  return str;
}

function generateFilename(category, startDate, endDate) {
  if (output) return output;
  
  const timestamp = new Date().toISOString().split('T')[0];
  let filename = `${category}_${timestamp}`;
  
  if (startDate || endDate) {
    const start = startDate ? startDate.split('T')[0] : 'start';
    const end = endDate ? endDate.split('T')[0] : 'end';
    filename += `_${start}_to_${end}`;
  }
  
  return `${filename}.csv`;
}

async function exportToCSV() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        console.error('❌ Error opening database:', err.message);
        console.error('💡 Make sure the scraper has run at least once to create the database.');
        reject(err);
        return;
      }

      // Build SQL query
      let sql = `
        SELECT 
          id, captured_at, source_page, dom_path, context_text,
          raw_value, data_category, data_type, numeric_value,
          unit, parsed_ts, confidence_score, metadata, created_at
        FROM captured_data 
        WHERE data_category = ?
      `;
      
      const params = [category];
      
      if (startDate) {
        sql += ' AND captured_at >= ?';
        params.push(startDate);
      }
      
      if (endDate) {
        sql += ' AND captured_at <= ?';
        params.push(endDate);
      }
      
      sql += ' ORDER BY captured_at ASC, id ASC';

      db.all(sql, params, (err, rows) => {
        db.close();
        
        if (err) {
          reject(err);
          return;
        }
        
        if (rows.length === 0) {
          console.log(`📭 No records found for category "${category}"`);
          if (startDate || endDate) {
            console.log(`💡 Try adjusting the date range or check if data exists for this period`);
          }
          console.log(`💡 Run "node list_categories.js" to see available categories and record counts`);
          resolve();
          return;
        }

        // Generate filename
        const filename = generateFilename(category, startDate, endDate);
        
        console.log(`📤 Exporting ${rows.length} records to ${filename}...`);

        // CSV Headers
        const headers = [
          'id', 'captured_at', 'source_page', 'dom_path', 'context_text',
          'raw_value', 'data_category', 'data_type', 'numeric_value',
          'unit', 'parsed_ts', 'confidence_score', 'metadata', 'created_at'
        ];

        // Build CSV content
        let csvContent = headers.join(',') + '\n';
        
        rows.forEach(row => {
          const csvRow = headers.map(header => {
            let value = row[header];
            
            // Special formatting for specific fields
            if (header === 'confidence_score' && value !== null) {
              value = parseFloat(value).toFixed(3);
            }
            
            if (header === 'numeric_value' && value !== null) {
              value = parseFloat(value);
            }
            
            return escapeCSV(value);
          });
          
          csvContent += csvRow.join(',') + '\n';
        });

        // Write to file
        try {
          fs.writeFileSync(filename, csvContent, 'utf8');
          
          console.log(`✅ Export completed successfully!`);
          console.log(`📁 File: ${path.resolve(filename)}`);
          console.log(`📊 Records: ${rows.length}`);
          console.log(`🏷️  Category: ${category}`);
          
          if (startDate || endDate) {
            console.log(`📅 Date range: ${startDate || 'beginning'} to ${endDate || 'end'}`);
          }
          
          // Show some statistics
          const uniquePages = new Set(rows.map(r => r.source_page)).size;
          const dateRange = {
            start: rows[0]?.captured_at,
            end: rows[rows.length - 1]?.captured_at
          };
          
          console.log(`\n📈 Export Statistics:`);
          console.log(`  • Unique pages: ${uniquePages}`);
          console.log(`  • Date range: ${formatTimestamp(dateRange.start)} to ${formatTimestamp(dateRange.end)}`);
          console.log(`  • Data types: ${[...new Set(rows.map(r => r.data_type))].join(', ')}`);
          
          const avgConfidence = rows.reduce((sum, r) => sum + (r.confidence_score || 0), 0) / rows.length;
          console.log(`  • Average confidence: ${(avgConfidence * 100).toFixed(1)}%`);
          
          console.log(`\n💡 Tips:`);
          console.log(`  • Open ${filename} in Excel, Google Sheets, or any CSV reader`);
          console.log(`  • Use the numeric_value column for calculations`);
          console.log(`  • Check confidence_score to identify potentially misclassified data`);
          console.log(`  • The metadata column contains additional context in JSON format`);
          
          resolve();
          
        } catch (writeError) {
          console.error('❌ Error writing CSV file:', writeError.message);
          reject(writeError);
        }
      });
    });
  });
}

// Main execution
exportToCSV().catch(err => {
  console.error('❌ Export failed:', err.message);
  process.exit(1);
});