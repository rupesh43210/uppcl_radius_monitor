#!/usr/bin/env node

const express = require('express');
const path = require('path');
const UppclPowerMonitor = require('./optimized_monitor');
const DailyConsumptionCalculator = require('./daily_consumption_calculator');

/**
 * UPPCL Power Monitoring Web Dashboard
 * Real-time monitoring dashboard for Grid/DG status and consumption
 */

class PowerDashboard {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.monitor = new UppclPowerMonitor();
    this.dailyCalculator = new DailyConsumptionCalculator();
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'dashboard')));
    
    // CORS for development
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });
  }

  setupRoutes() {
    // Serve dashboard
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
    });

    // API Routes
    this.app.get('/api/status', async (req, res) => {
      try {
        await this.monitor.initDatabase();
        const latestData = await this.monitor.getHistoricalData(0.5); // Last 30 minutes
        const balanceData = await this.monitor.getHistoricalData(24); // Last 24 hours for balance (balance changes less frequently)
        const gridEvents = await this.monitor.getGridEvents();
        
        const status = {
          timestamp: new Date().toISOString(),
          grid: {
            status: 'unknown',
            consumption: null,
            unit: null,
            period: null,
            todayConsumption: null,
            meterReading: null,
            balance: null,
            lastInterruption: gridEvents.lastInterruption,
            lastRestoration: gridEvents.lastRestoration
          },
          dg: {
            status: 'unknown', 
            consumption: null,
            unit: null,
            period: null
          }
        };

        // Get calculated today's consumption
        try {
          const todayConsumption = await this.dailyCalculator.getTodayConsumption();
          if (todayConsumption) {
            status.grid.todayConsumption = {
              value: todayConsumption.value,
              unit: todayConsumption.unit,
              isRealTimeCalculated: true,
              confidence: todayConsumption.confidence,
              hasGaps: todayConsumption.hasGaps
            };
            console.log(`📅 Serving calculated today's consumption: ${todayConsumption.value.toFixed(2)} ${todayConsumption.unit}`);
          }
        } catch (error) {
          console.error('❌ Error getting calculated today\'s consumption:', error);
        }

        latestData.forEach(record => {
          if (record.source === 'grid') {
            if (record.category === 'availability') {
              status.grid.status = record.status;
            } else if (record.category === 'consumption') {
              // Skip old scraped "today" data - we're using calculated values now
              if (record.period !== 'today') {
                status.grid.consumption = record.consumption_value;
                status.grid.unit = record.consumption_unit;
                status.grid.period = record.period;
              }
            } else if (record.category === 'meter_reading') {
              status.grid.meterReading = {
                value: record.consumption_value,
                unit: record.consumption_unit
              };
            }
          } else if (record.source === 'dg') {
            if (record.category === 'availability') {
              status.dg.status = record.status;
            } else if (record.category === 'consumption') {
              status.dg.consumption = record.consumption_value;
              status.dg.unit = record.consumption_unit;
              status.dg.period = record.period;
            }
          }
        });

        // Get the most recent balance from last 24 hours
        const balanceRecord = balanceData.find(record => 
          record.source === 'grid' && record.category === 'balance'
        );
        if (balanceRecord) {
          status.grid.balance = {
            value: balanceRecord.consumption_value,
            unit: balanceRecord.consumption_unit
          };
        }

        res.json(status);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/history', async (req, res) => {
      try {
        const hours = parseInt(req.query.hours) || 24;
        const limit = parseInt(req.query.limit) || 1000;
        const startDate = req.query.start_date; // YYYY-MM-DD format
        const endDate = req.query.end_date;     // YYYY-MM-DD format
        const startDateTime = req.query.start_datetime; // ISO format
        const endDateTime = req.query.end_datetime;     // ISO format
        const category = req.query.category;     // Filter by category
        const source = req.query.source;        // Filter by source
        const period = req.query.period;        // Filter by period (for consumption data)
        const changesFilter = req.query.changes_filter; // Filter for changes only
        
        await this.monitor.initDatabase();
        let history = await this.monitor.getHistoricalData(hours, limit, {
          startDate,
          endDate, 
          startDateTime,
          endDateTime,
          category,
          source,
          period,
          changesFilter
        });
        
        // Filter out old scraped "today" consumption data ONLY if not specifically requesting today's data
        if (!(category === 'consumption' && period === 'today')) {
          history = history.filter(record => {
            return !(record.category === 'consumption' && record.period === 'today');
          });
        }
        
        // Apply changes-only filtering if requested
        if (changesFilter === 'changes_only') {
          history = this.filterChangesOnly(history);
          console.log(`🔍 Applied changes-only filter, reduced to ${history.length} records`);
        } else if (changesFilter === 'no_duplicates') {
          history = this.filterNoDuplicates(history);
          console.log(`🎯 Applied no-duplicates filter, reduced to ${history.length} records`);
        }
        
        // Add calculated today's consumption for current day entries
        try {
          const todayConsumption = await this.dailyCalculator.getTodayConsumption();
          if (todayConsumption) {
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            
            // Add today's consumption entry for each unique timestamp from today
            const todayTimestamps = new Set();
            history.forEach(record => {
              if (record.timestamp.startsWith(today)) {
                todayTimestamps.add(record.timestamp);
              }
            });
            
            // Add consumption data for each timestamp
            Array.from(todayTimestamps).forEach(timestamp => {
              const syntheticEntry = {
                id: `calc_${new Date(timestamp).getTime()}`,
                timestamp: timestamp,
                category: 'consumption',
                source: 'grid',
                status: null,
                consumption_value: todayConsumption.value,
                consumption_unit: todayConsumption.unit,
                period: 'today',
                confidence: todayConsumption.confidence,
                metadata: JSON.stringify({ calculated: true, hasGaps: todayConsumption.hasGaps }),
                fingerprint: `calc_today_${timestamp}`,
                created_at: timestamp
              };
              history.push(syntheticEntry);
            });
          }
        } catch (error) {
          console.error('Error adding calculated consumption to history:', error);
        }
        
        res.json(history);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/trigger-monitoring', async (req, res) => {
      try {
        const data = await this.monitor.performMonitoring();
        res.json({ success: true, recordsFound: data.length });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '2.0.0'
      });
    });
  }

  // Filter to show only records where meaningful values changed
  // Tracks changes in: Today's Usage, This Month, Meter Reading, Grid Status, Balance
  filterChangesOnly(history) {
    if (history.length === 0) return history;
    
    const changes = [];
    const lastValues = new Map(); // Track last value for each meaningful data type
    
    // Sort by timestamp ascending to process chronologically
    const sortedHistory = [...history].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    for (const record of sortedHistory) {
      let shouldInclude = false;
      let trackingKey = null;
      let currentValue = null;
      
      // Define what constitutes a meaningful change based on category and period
      if (record.category === 'consumption' && record.period === 'today') {
        // Today's Usage
        trackingKey = 'today_usage';
        currentValue = record.consumption_value;
      } else if (record.category === 'consumption' && record.period === 'month') {
        // This Month's consumption
        trackingKey = 'month_usage';
        currentValue = record.consumption_value;
      } else if (record.category === 'meter_reading') {
        // Meter Reading
        trackingKey = `meter_${record.source}`;
        currentValue = record.consumption_value;
      } else if (record.category === 'availability') {
        // Grid Status (online/offline)
        trackingKey = `status_${record.source}`;
        currentValue = record.status;
      } else if (record.category === 'balance') {
        // Balance amount
        trackingKey = 'balance';
        currentValue = record.consumption_value;
      }
      
      // Check if this is a meaningful change
      if (trackingKey) {
        const lastValue = lastValues.get(trackingKey);
        
        // Include if it's the first record for this type or if value changed
        if (lastValue === undefined || currentValue !== lastValue) {
          shouldInclude = true;
          lastValues.set(trackingKey, currentValue);
        }
      }
      
      if (shouldInclude) {
        changes.push(record);
      }
    }
    
    console.log(`🔍 Applied changes-only filter, reduced to ${changes.length} records`);
    
    // Return in original order (timestamp DESC)
    return changes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  // Filter to remove consecutive duplicates (same value, same category+source)
  filterNoDuplicates(history) {
    if (history.length === 0) return history;
    
    const filtered = [];
    const lastRecord = new Map(); // Track last record for each category+source combination
    
    for (const record of history) {
      const key = `${record.category}_${record.source}`;
      const lastRec = lastRecord.get(key);
      
      // Include if it's the first record for this category+source or if it's different from the last
      if (!lastRec || 
          lastRec.consumption_value !== record.consumption_value ||
          lastRec.status !== record.status) {
        filtered.push(record);
        lastRecord.set(key, record);
      }
    }
    
    return filtered;
  }

  async start() {
    this.setupMiddleware();
    this.setupRoutes();
    
    this.server = this.app.listen(this.port, () => {
      console.log(`🌐 UPPCL Power Dashboard running on http://localhost:${this.port}`);
      console.log(`📊 API endpoints available:`);
      console.log(`   • GET  /api/status - Current Grid/DG status`);
      console.log(`   • GET  /api/history?hours=24 - Historical data`);
      console.log(`   • POST /api/trigger-monitoring - Manual monitoring trigger`);
      console.log(`   • GET  /api/health - Health check`);
      
      // Start automatic monitoring every minute
      console.log(`⏰ Starting automatic monitoring (every 1 minute)...`);
      this.monitor.startScheduler();
    });
  }
}

// Start dashboard if called directly
if (require.main === module) {
  const dashboard = new PowerDashboard();
  dashboard.start().catch(console.error);
}

module.exports = PowerDashboard;