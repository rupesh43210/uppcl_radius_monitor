#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * Power Source Analytics for UPPCL Scraper
 * Analyzes Grid/DG availability and consumption patterns
 */

const dbPath = path.join(__dirname, 'charges.db');
const db = new sqlite3.Database(dbPath);

console.log('⚡ UPPCL Power Source Analytics');
console.log('=' .repeat(80));

// 1. Grid/DG Availability Timeline
console.log('\n🔌 POWER SOURCE AVAILABILITY ANALYSIS');
console.log('-'.repeat(80));

db.all(`
    SELECT 
        data_category,
        raw_value as status,
        COUNT(*) as occurrences,
        MAX(captured_at) as last_seen,
        MIN(captured_at) as first_seen
    FROM captured_data 
    WHERE data_category IN ('grid_availability', 'dg_availability', 'grid_status', 'dg_status')
    GROUP BY data_category, raw_value
    ORDER BY data_category, occurrences DESC
`, [], (err, rows) => {
    if (err) {
        console.error('Error:', err);
        return;
    }
    
    console.log('Source'.padEnd(20) + 'Status'.padEnd(15) + 'Count'.padEnd(8) + 'Last Seen'.padEnd(25) + 'First Seen');
    console.log('-'.repeat(80));
    
    let gridOnline = 0, gridOffline = 0, dgOnline = 0, dgOffline = 0;
    
    rows.forEach(row => {
        const source = row.data_category.includes('grid') ? 'Grid' : 'DG';
        const status = row.status;
        const lastSeen = new Date(row.last_seen).toLocaleString();
        const firstSeen = new Date(row.first_seen).toLocaleString();
        
        console.log(
            source.padEnd(20) + 
            status.padEnd(15) + 
            row.occurrences.toString().padEnd(8) + 
            lastSeen.padEnd(25) + 
            firstSeen
        );
        
        // Count status for reliability calculation
        if (source === 'Grid') {
            if (status.includes('online') || status.includes('available')) gridOnline += row.occurrences;
            else gridOffline += row.occurrences;
        } else {
            if (status.includes('online') || status.includes('available')) dgOnline += row.occurrences;
            else dgOffline += row.occurrences;
        }
    });
    
    // Calculate reliability percentages
    const gridTotal = gridOnline + gridOffline;
    const dgTotal = dgOnline + dgOffline;
    
    console.log('\n📊 RELIABILITY SUMMARY:');
    if (gridTotal > 0) {
        console.log(`   Grid Reliability: ${((gridOnline / gridTotal) * 100).toFixed(1)}% (${gridOnline}/${gridTotal} online readings)`);
    }
    if (dgTotal > 0) {
        console.log(`   DG Reliability: ${((dgOnline / dgTotal) * 100).toFixed(1)}% (${dgOnline}/${dgTotal} online readings)`);
    }
    
    // 2. Consumption Analysis
    console.log('\n\n⚡ POWER CONSUMPTION ANALYSIS');
    console.log('-'.repeat(80));
    
    db.all(`
        SELECT 
            data_category,
            raw_value,
            numeric_value,
            unit,
            metadata,
            captured_at
        FROM captured_data 
        WHERE data_category IN ('grid_consumption', 'dg_consumption', 'power_consumption', 'live_consumption')
           OR (data_category = 'units_consumed' AND raw_value LIKE '%KWH%')
        ORDER BY captured_at DESC
        LIMIT 20
    `, [], (err, consumptionRows) => {
        if (err) {
            console.error('Error:', err);
            return;
        }
        
        console.log('Source'.padEnd(20) + 'Consumption'.padEnd(15) + 'Period'.padEnd(12) + 'Captured At');
        console.log('-'.repeat(80));
        
        let totalGridConsumption = 0;
        let totalDgConsumption = 0;
        
        consumptionRows.forEach(row => {
            let source = 'Unknown';
            let period = 'Unknown';
            
            if (row.data_category.includes('grid')) {
                source = 'Grid';
                if (row.numeric_value) totalGridConsumption += row.numeric_value;
            } else if (row.data_category.includes('dg')) {
                source = 'DG';
                if (row.numeric_value) totalDgConsumption += row.numeric_value;
            } else if (row.data_category === 'units_consumed') {
                source = 'Grid'; // Assume units_consumed is grid unless specified
                if (row.numeric_value) totalGridConsumption += row.numeric_value;
            }
            
            // Try to extract period from metadata
            if (row.metadata) {
                try {
                    const meta = JSON.parse(row.metadata);
                    if (meta.period) period = meta.period;
                } catch (e) {
                    // Ignore JSON parse errors
                }
            }
            
            const capturedAt = new Date(row.captured_at).toLocaleString();
            
            console.log(
                source.padEnd(20) + 
                row.raw_value.padEnd(15) + 
                period.padEnd(12) + 
                capturedAt
            );
        });
        
        console.log('\n💡 CONSUMPTION SUMMARY:');
        if (totalGridConsumption > 0) {
            console.log(`   Total Grid Consumption: ${totalGridConsumption.toFixed(2)} KWH`);
        }
        if (totalDgConsumption > 0) {
            console.log(`   Total DG Consumption: ${totalDgConsumption.toFixed(2)} KWH`);
        }
        
        // 3. Power Switching Events
        console.log('\n\n🔄 POWER SWITCHING EVENTS');
        console.log('-'.repeat(80));
        
        db.all(`
            SELECT 
                data_category,
                raw_value,
                context_text,
                captured_at
            FROM captured_data 
            WHERE data_category IN ('grid_failure', 'grid_restore', 'dg_start', 'dg_stop', 'power_event')
            ORDER BY captured_at DESC
            LIMIT 10
        `, [], (err, eventRows) => {
            if (err) {
                console.error('Error:', err);
                db.close();
                return;
            }
            
            if (eventRows.length === 0) {
                console.log('No power switching events detected yet.');
            } else {
                console.log('Event Type'.padEnd(20) + 'Description'.padEnd(30) + 'Time');
                console.log('-'.repeat(80));
                
                eventRows.forEach(row => {
                    const eventType = row.data_category.replace('_', ' ').toUpperCase();
                    const description = row.raw_value.substring(0, 28);
                    const time = new Date(row.captured_at).toLocaleString();
                    
                    console.log(
                        eventType.padEnd(20) + 
                        description.padEnd(30) + 
                        time
                    );
                });
            }
            
            // 4. API Endpoints Discovered
            console.log('\n\n🌐 LIVE DATA API ENDPOINTS');
            console.log('-'.repeat(80));
            
            db.all(`
                SELECT DISTINCT
                    raw_value,
                    context_text,
                    confidence_score
                FROM captured_data 
                WHERE data_category IN ('api_endpoint', 'live_api_call')
                ORDER BY confidence_score DESC
            `, [], (err, apiRows) => {
                if (err) {
                    console.error('Error:', err);
                    db.close();
                    return;
                }
                
                if (apiRows.length === 0) {
                    console.log('No live data API endpoints discovered yet.');
                    console.log('💡 The mobile app may use different endpoints for real-time data.');
                } else {
                    console.log('Endpoint'.padEnd(50) + 'Confidence'.padEnd(12) + 'Context');
                    console.log('-'.repeat(80));
                    
                    apiRows.forEach(row => {
                        const endpoint = row.raw_value.substring(0, 48);
                        const confidence = `${(row.confidence_score * 100).toFixed(1)}%`;
                        const context = row.context_text ? row.context_text.substring(0, 30) : '';
                        
                        console.log(
                            endpoint.padEnd(50) + 
                            confidence.padEnd(12) + 
                            context
                        );
                    });
                }
                
                // 5. Recommendations
                console.log('\n\n🎯 POWER MONITORING RECOMMENDATIONS');
                console.log('='.repeat(80));
                
                const recommendations = [
                    '🔥 HIGH PRIORITY: Monitor Grid/DG status every 1-2 minutes during peak hours',
                    '⚡ CRITICAL: Set up alerts for Grid failures and DG startup events',
                    '📊 IMPORTANT: Track monthly consumption by source (Grid vs DG)',
                    '🔍 INVESTIGATE: Check mobile app network traffic for live consumption APIs',
                    '⏰ SCHEDULE: More frequent monitoring during typical outage times',
                    '💾 STORAGE: Keep power event history for reliability analysis',
                    '📱 MOBILE: Consider reverse engineering mobile app for real-time data'
                ];
                
                recommendations.forEach((rec, index) => {
                    console.log(`\n${index + 1}. ${rec}`);
                });
                
                console.log('\n' + '='.repeat(80));
                console.log('💡 SUMMARY: Focus on availability monitoring and consumption tracking');
                console.log('🔧 NEXT: Set up real-time alerts for power source changes');
                
                db.close();
            });
        });
    });
});