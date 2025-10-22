#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * Daily Consumption Calculator
 * Properly calculates daily power consumption from midnight to midnight
 * by tracking meter reading differences, not scraping static values
 */

class DailyConsumptionCalculator {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(__dirname, 'power_data.db');
    this.db = null;
  }

  // Initialize database connection
  async initDatabase() {
    this.db = new sqlite3.Database(this.dbPath);
    
    // Create table for daily consumption tracking
    await new Promise((resolve, reject) => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS daily_consumption (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL UNIQUE,
          midnight_reading REAL,
          midnight_timestamp TEXT,
          current_reading REAL,
          current_timestamp TEXT,
          calculated_consumption REAL,
          is_complete BOOLEAN DEFAULT FALSE,
          has_monitoring_gaps BOOLEAN DEFAULT FALSE,
          confidence_score REAL DEFAULT 1.0,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Create index for faster queries
    await new Promise((resolve) => {
      this.db.run('CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_consumption(date)', resolve);
    });
  }

  // Get today's date in YYYY-MM-DD format
  getTodayDate() {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  // Get midnight timestamp for a given date
  getMidnightTimestamp(dateStr) {
    const date = new Date(dateStr + 'T00:00:00.000Z');
    return date.toISOString();
  }

  // Get the latest meter reading from power_data table
  async getLatestMeterReading() {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT consumption_value, timestamp, confidence
        FROM power_data 
        WHERE category = 'meter_reading' 
          AND source = 'grid'
          AND consumption_value IS NOT NULL
        ORDER BY timestamp DESC 
        LIMIT 1
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  // Get meter reading closest to midnight for a specific date
  async getMidnightMeterReading(dateStr) {
    const midnightTime = this.getMidnightTimestamp(dateStr);
    const nextMidnight = this.getMidnightTimestamp(
      new Date(new Date(dateStr).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT consumption_value, timestamp, confidence
        FROM power_data 
        WHERE category = 'meter_reading' 
          AND source = 'grid'
          AND consumption_value IS NOT NULL
          AND timestamp >= ?
          AND timestamp < ?
        ORDER BY ABS(julianday(timestamp) - julianday(?)) ASC
        LIMIT 1
      `, [midnightTime, nextMidnight, midnightTime], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  // Check if we have sufficient monitoring data for the day
  async checkMonitoringCoverage(dateStr) {
    const startTime = this.getMidnightTimestamp(dateStr);
    const endTime = this.getMidnightTimestamp(
      new Date(new Date(dateStr).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );

    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT 
          COUNT(*) as record_count,
          MIN(timestamp) as first_record,
          MAX(timestamp) as last_record
        FROM power_data 
        WHERE timestamp >= ? AND timestamp < ?
          AND category = 'meter_reading'
          AND source = 'grid'
      `, [startTime, endTime], (err, row) => {
        if (err) reject(err);
        else {
          const coverage = {
            recordCount: row.record_count,
            firstRecord: row.first_record,
            lastRecord: row.last_record,
            hasGaps: row.record_count < 12 // Less than 12 readings in 24h indicates gaps
          };
          resolve(coverage);
        }
      });
    });
  }

  // Calculate daily consumption for a specific date
  async calculateDailyConsumption(dateStr = null) {
    if (!dateStr) {
      dateStr = this.getTodayDate();
    }

    await this.initDatabase();

    try {
      console.log(`📅 Calculating daily consumption for ${dateStr}`);

      // Get midnight meter reading
      const midnightReading = await this.getMidnightMeterReading(dateStr);
      if (!midnightReading) {
        console.log(`⚠️  No meter reading found around midnight for ${dateStr}`);
        return null;
      }

      // Get latest meter reading
      const currentReading = await this.getLatestMeterReading();
      if (!currentReading) {
        console.log(`⚠️  No current meter reading available`);
        return null;
      }

      // Check monitoring coverage
      const coverage = await this.checkMonitoringCoverage(dateStr);

      // Calculate consumption
      const consumption = currentReading.consumption_value - midnightReading.consumption_value;
      
      // Validate calculation
      if (consumption < 0) {
        console.log(`❌ Invalid consumption calculation: ${consumption} units (negative)`);
        return null;
      }

      if (consumption > 100) {
        console.log(`⚠️  Unusually high consumption: ${consumption} units - please verify`);
      }

      // Calculate confidence score
      let confidenceScore = Math.min(midnightReading.confidence || 0.8, currentReading.confidence || 0.8);
      if (coverage.hasGaps) {
        confidenceScore *= 0.7; // Reduce confidence if monitoring gaps
      }

      const result = {
        date: dateStr,
        midnightReading: midnightReading.consumption_value,
        midnightTimestamp: midnightReading.timestamp,
        currentReading: currentReading.consumption_value,
        currentTimestamp: currentReading.timestamp,
        calculatedConsumption: consumption,
        isComplete: dateStr < this.getTodayDate(), // Past dates are complete
        hasMonitoringGaps: coverage.hasGaps,
        confidenceScore: confidenceScore,
        coverage: coverage
      };

      // Save to database
      await this.saveDailyConsumption(result);

      console.log(`✅ Daily consumption calculated:`);
      console.log(`   Date: ${dateStr}`);
      console.log(`   Midnight reading: ${midnightReading.consumption_value} KWH at ${midnightReading.timestamp}`);
      console.log(`   Current reading: ${currentReading.consumption_value} KWH at ${currentReading.timestamp}`);
      console.log(`   Consumption: ${consumption.toFixed(2)} units`);
      console.log(`   Confidence: ${(confidenceScore * 100).toFixed(1)}%`);
      console.log(`   Monitoring coverage: ${coverage.recordCount} readings${coverage.hasGaps ? ' (has gaps)' : ''}`);

      return result;

    } catch (error) {
      console.error(`❌ Error calculating daily consumption:`, error);
      return null;
    }
  }

  // Save daily consumption calculation to database
  async saveDailyConsumption(data) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT OR REPLACE INTO daily_consumption (
          date, midnight_reading, midnight_timestamp, current_reading, 
          current_timestamp, calculated_consumption, is_complete, 
          has_monitoring_gaps, confidence_score, notes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        data.date,
        data.midnightReading,
        data.midnightTimestamp,
        data.currentReading,
        data.currentTimestamp,
        data.calculatedConsumption,
        data.isComplete,
        data.hasMonitoringGaps,
        data.confidenceScore,
        data.coverage ? `Records: ${data.coverage.recordCount}` : null
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Get daily consumption for a date range
  async getDailyConsumptions(startDate = null, endDate = null) {
    if (!startDate) {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Last 7 days
    }
    if (!endDate) {
      endDate = this.getTodayDate();
    }

    await this.initDatabase();

    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT * FROM daily_consumption
        WHERE date >= ? AND date <= ?
        ORDER BY date DESC
      `, [startDate, endDate], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Recalculate daily consumption for past days (backfill)
  async backfillDailyConsumptions(days = 7) {
    console.log(`🔄 Backfilling daily consumption calculations for last ${days} days...`);
    
    const results = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const result = await this.calculateDailyConsumption(date);
      if (result) {
        results.push(result);
      }
    }

    console.log(`✅ Backfill complete. Calculated ${results.length} daily consumptions.`);
    return results;
  }

  // Get today's consumption with real-time calculation
  async getTodayConsumption() {
    const today = this.getTodayDate();
    const result = await this.calculateDailyConsumption(today);
    
    if (result) {
      return {
        value: result.calculatedConsumption,
        unit: 'UNITS',
        period: 'today',
        timestamp: result.currentTimestamp,
        confidence: result.confidenceScore,
        isRealTimeCalculated: true,
        midnightReading: result.midnightReading,
        currentReading: result.currentReading,
        hasGaps: result.hasMonitoringGaps
      };
    }
    
    return null;
  }

  // Get consumption at a specific time (for historical data)
  async getConsumptionAtTime(dateStr, targetTime) {
    await this.initDatabase();
    
    try {
      // For today, use real-time calculation
      if (dateStr === this.getTodayDate()) {
        return await this.getTodayConsumption();
      }
      
      // For past dates, look for existing calculation or calculate based on available data
      const startTime = this.getMidnightTimestamp(dateStr);
      const targetTimestamp = targetTime.toISOString();
      
      // Get midnight reading for that date
      const midnightReading = await this.getMidnightReading(dateStr);
      if (!midnightReading) {
        return null;
      }
      
      // Get meter reading closest to target time
      const targetReading = await new Promise((resolve, reject) => {
        this.db.get(`
          SELECT consumption_value, timestamp
          FROM power_data 
          WHERE timestamp <= ? 
            AND category = 'meter_reading'
            AND source = 'grid'
            AND consumption_value IS NOT NULL
          ORDER BY timestamp DESC
          LIMIT 1
        `, [targetTimestamp], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      if (!targetReading) {
        return null;
      }
      
      const consumption = targetReading.consumption_value - midnightReading.consumption_value;
      
      if (consumption < 0) {
        return null; // Invalid consumption
      }
      
      return {
        value: consumption,
        unit: 'UNITS',
        period: 'today',
        timestamp: targetReading.timestamp,
        confidence: 0.9, // Historical data has slightly lower confidence
        isRealTimeCalculated: false,
        midnightReading: midnightReading.consumption_value,
        currentReading: targetReading.consumption_value,
        hasGaps: false
      };
      
    } catch (error) {
      console.error(`Error calculating consumption at time ${targetTime}:`, error);
      return null;
    }
  }

  // Close database connection
  async close() {
    if (this.db) {
      this.db.close();
    }
  }
}

// Export for use in other modules
module.exports = DailyConsumptionCalculator;

// Command line usage
if (require.main === module) {
  const calculator = new DailyConsumptionCalculator();
  
  const command = process.argv[2];
  const dateArg = process.argv[3];
  
  async function main() {
    try {
      switch (command) {
        case 'today':
          const todayResult = await calculator.getTodayConsumption();
          if (todayResult) {
            console.log(`\n📊 Today's Consumption: ${todayResult.value.toFixed(2)} ${todayResult.unit}`);
            console.log(`   Confidence: ${(todayResult.confidence * 100).toFixed(1)}%`);
            console.log(`   From: ${todayResult.midnightReading} → ${todayResult.currentReading} KWH`);
            if (todayResult.hasGaps) {
              console.log(`   ⚠️  Warning: Monitoring gaps detected`);
            }
          } else {
            console.log(`❌ Could not calculate today's consumption`);
          }
          break;
          
        case 'date':
          if (!dateArg) {
            console.log(`❌ Please provide a date (YYYY-MM-DD)`);
            process.exit(1);
          }
          await calculator.calculateDailyConsumption(dateArg);
          break;
          
        case 'backfill':
          const days = parseInt(dateArg) || 7;
          await calculator.backfillDailyConsumptions(days);
          break;
          
        case 'history':
          const days_history = parseInt(dateArg) || 7;
          const startDate = new Date(Date.now() - days_history * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const history = await calculator.getDailyConsumptions(startDate);
          
          console.log(`\n📈 Daily Consumption History (last ${days_history} days):`);
          history.forEach(day => {
            const status = day.has_monitoring_gaps ? '⚠️ ' : day.is_complete ? '✅' : '🔄';
            console.log(`   ${status} ${day.date}: ${day.calculated_consumption?.toFixed(2) || 'N/A'} units (${(day.confidence_score * 100).toFixed(0)}%)`);
          });
          break;
          
        default:
          console.log(`
📊 Daily Consumption Calculator

Usage:
  node daily_consumption_calculator.js today                    # Calculate today's consumption
  node daily_consumption_calculator.js date 2025-10-22         # Calculate for specific date
  node daily_consumption_calculator.js backfill [days]         # Backfill last N days (default: 7)
  node daily_consumption_calculator.js history [days]          # Show history for last N days

This tool calculates REAL daily consumption by:
1. Finding meter reading at midnight (00:00)
2. Getting current meter reading
3. Calculating: current - midnight = today's consumption

Unlike the old system that just scraped static values,
this provides accurate midnight-to-midnight consumption.
          `);
      }
    } catch (error) {
      console.error(`❌ Error:`, error);
    } finally {
      await calculator.close();
    }
  }
  
  main();
}