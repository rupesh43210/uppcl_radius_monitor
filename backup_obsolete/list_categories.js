#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './charges.db';

// Parse command line arguments
const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');
const showSamples = !args.includes('--no-samples');

if (showHelp) {
  console.log(`
🏷️  List Data Categories

Usage: node list_categories.js [options]

Options:
  --no-samples        Don't show sample records for each category
  --help, -h          Show this help message

This script shows all discovered data categories with:
- Record counts
- Confidence score averages
- Sample records (unless --no-samples is used)
- Recent activity timestamps
`);
  process.exit(0);
}

function formatTimestamp(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleString();
}

function truncateText(text, maxLength = 40) {
  if (!text) return 'N/A';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

async function listCategories() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        console.error('❌ Error opening database:', err.message);
        console.error('💡 Make sure the scraper has run at least once to create the database.');
        reject(err);
        return;
      }

      // Get category summary
      const summarySQL = `
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

      db.all(summarySQL, [], (err, categories) => {
        if (err) {
          db.close();
          reject(err);
          return;
        }
        
        if (categories.length === 0) {
          console.log('📭 No categories found.');
          console.log('💡 Make sure the scraper has run at least once to capture data.');
          db.close();
          resolve();
          return;
        }

        console.log('\n🏷️  Data Categories Summary');
        console.log('=' .repeat(100));
        
        console.log(`${'Category'.padEnd(20)} ${'Count'.padEnd(8)} ${'Confidence'.padEnd(12)} ${'Pages'.padEnd(8)} ${'First Seen'.padEnd(20)} ${'Last Seen'.padEnd(20)}`);
        console.log('-'.repeat(100));
        
        categories.forEach(cat => {
          const confidence = cat.avg_confidence ? `${(cat.avg_confidence * 100).toFixed(1)}%` : 'N/A';
          
          console.log(
            `${cat.data_category.padEnd(20)} ` +
            `${cat.record_count.toString().padEnd(8)} ` +
            `${confidence.padEnd(12)} ` +
            `${cat.page_count.toString().padEnd(8)} ` +
            `${formatTimestamp(cat.first_seen).substring(0, 19).padEnd(20)} ` +
            `${formatTimestamp(cat.last_seen).substring(0, 19).padEnd(20)}`
          );
        });
        
        console.log('-'.repeat(100));
        console.log(`\nTotal categories: ${categories.length}`);
        console.log(`Total records: ${categories.reduce((sum, cat) => sum + cat.record_count, 0)}`);

        if (!showSamples) {
          db.close();
          resolve();
          return;
        }

        // Get sample records for each category
        console.log('\n📋 Sample Records by Category');
        console.log('=' .repeat(120));

        let processedCategories = 0;
        
        categories.forEach(category => {
          const sampleSQL = `
            SELECT raw_value, data_type, numeric_value, unit, context_text, captured_at
            FROM captured_data 
            WHERE data_category = ? 
            ORDER BY captured_at DESC 
            LIMIT 3
          `;
          
          db.all(sampleSQL, [category.data_category], (err, samples) => {
            if (err) {
              console.error(`❌ Error getting samples for ${category.data_category}:`, err.message);
            } else {
              console.log(`\n📂 ${category.data_category.toUpperCase()} (${category.record_count} records)`);
              console.log('   ' + '-'.repeat(80));
              
              if (samples.length > 0) {
                samples.forEach((sample, index) => {
                  const value = sample.numeric_value !== null ? 
                    `${sample.numeric_value}${sample.unit ? ' ' + sample.unit : ''}` : 
                    sample.raw_value;
                  
                  console.log(`   ${index + 1}. ${truncateText(value, 20)} | ${sample.data_type} | ${truncateText(sample.context_text, 40)}`);
                });
              } else {
                console.log('   No samples available');
              }
            }
            
            processedCategories++;
            if (processedCategories === categories.length) {
              db.close();
              
              console.log('\n💡 Tips:');
              console.log('  • Use query_latest.js --category=NAME to see more records from a specific category');
              console.log('  • Use export_csv.js --category=NAME to export category data to CSV');
              console.log('  • Categories with low confidence scores may need manual review');
              console.log('  • "unknown" category contains unclassified data that might need custom rules');
              
              resolve();
            }
          });
        });
      });
    });
  });
}

// Main execution
listCategories().catch(err => {
  console.error('❌ List categories failed:', err.message);
  process.exit(1);
});