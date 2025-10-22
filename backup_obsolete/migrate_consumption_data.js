#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * Migration Script - Clean up inaccurate scraped "today" consumption data
 * This removes old static scraped values that were not real calculations
 */

class ConsumptionDataMigration {
  constructor() {
    this.dbPath = path.join(__dirname, 'power_data.db');
    this.db = null;
  }

  async migrate() {
    this.db = new sqlite3.Database(this.dbPath);
    
    console.log('🔄 Starting consumption data migration...');
    
    try {
      // First, let's see what "today" consumption data we currently have
      const todayData = await this.getCurrentTodayData();
      
      if (todayData.length > 0) {
        console.log(`\n📊 Found ${todayData.length} existing "today" consumption records:`);
        todayData.forEach((record, index) => {
          console.log(`   ${index + 1}. ${record.consumption_value} ${record.consumption_unit} (${record.timestamp})`);
        });

        // Remove old scraped "today" consumption data that was inaccurate
        const removedCount = await this.removeScrapedTodayData();
        console.log(`\n🗑️  Removed ${removedCount} old scraped "today" consumption records`);
        console.log(`✅ These were replaced with real-time calculated values`);
      } else {
        console.log(`\n✅ No old "today" consumption data found - database is clean`);
      }

      // Show summary of what remains
      const remainingData = await this.getCurrentTodayData();
      console.log(`\n📈 Current consumption data summary:`);
      console.log(`   - Today's consumption records: ${remainingData.length}`);
      
      const allConsumption = await this.getAllConsumptionData();
      console.log(`   - Total consumption records: ${allConsumption.length}`);
      console.log(`   - Meter reading records: ${allConsumption.filter(r => r.category === 'meter_reading').length}`);
      console.log(`   - Monthly consumption records: ${allConsumption.filter(r => r.period && r.period.includes('month')).length}`);

      console.log(`\n✅ Migration completed successfully!`);
      console.log(`💡 The system will now use real-time calculated daily consumption from meter readings.`);

    } catch (error) {
      console.error('❌ Migration failed:', error);
    } finally {
      this.db.close();
    }
  }

  async getCurrentTodayData() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT * FROM power_data 
        WHERE category = 'consumption' 
          AND period = 'today'
        ORDER BY timestamp DESC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async getAllConsumptionData() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT category, period, COUNT(*) as count FROM power_data 
        GROUP BY category, period
        ORDER BY category, period
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async removeScrapedTodayData() {
    return new Promise((resolve, reject) => {
      this.db.run(`
        DELETE FROM power_data 
        WHERE category = 'consumption' 
          AND period = 'today'
          AND source = 'grid'
      `, function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
}

// Run migration
if (require.main === module) {
  const migration = new ConsumptionDataMigration();
  migration.migrate();
}

module.exports = ConsumptionDataMigration;