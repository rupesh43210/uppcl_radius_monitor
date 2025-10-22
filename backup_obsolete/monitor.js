#!/usr/bin/env node

const UppclPowerMonitor = require('./optimized_monitor');

/**
 * Simple runner for UPPCL Power Monitor
 * Performs a single monitoring cycle and exits
 */

async function runOnce() {
  const monitor = new UppclPowerMonitor();
  
  try {
    console.log('🚀 UPPCL Power Monitor - Single Run Mode');
    console.log('=' .repeat(50));
    
    const data = await monitor.performMonitoring();
    
    console.log('\n✅ Monitoring completed successfully');
    console.log(`📊 Data points collected: ${data.length}`);
    
    // Show summary
    const summary = data.reduce((acc, item) => {
      const key = `${item.source}_${item.category}`;
      acc[key] = item;
      return acc;
    }, {});
    
    console.log('\n📋 Summary:');
    Object.entries(summary).forEach(([key, item]) => {
      if (item.category === 'availability') {
        console.log(`   ${item.source.toUpperCase()} Status: ${item.status}`);
      } else if (item.category === 'consumption') {
        console.log(`   ${item.source.toUpperCase()} Consumption: ${item.value} ${item.unit} (${item.period})`);
      }
    });
    
  } catch (error) {
    console.error('❌ Monitoring failed:', error.message);
    process.exit(1);
  } finally {
    await monitor.close();
  }
}

async function runScheduled() {
  const monitor = new UppclPowerMonitor();
  
  try {
    console.log('🚀 UPPCL Power Monitor - Scheduled Mode');
    console.log('=' .repeat(50));
    
    await monitor.initDatabase();
    monitor.startScheduler();
    
    // Keep running
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down gracefully...');
      await monitor.close();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start scheduler:', error.message);
    process.exit(1);
  }
}

// Check command line arguments
const mode = process.argv[2];

if (mode === 'schedule') {
  runScheduled();
} else {
  runOnce();
}