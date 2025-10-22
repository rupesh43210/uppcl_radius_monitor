#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * Data Value Analytics for UPPCL Scraper
 * Analyzes captured data to determine most valuable categories for monitoring
 */

const dbPath = path.join(__dirname, 'charges.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 UPPCL Data Value Analysis');
console.log('=' .repeat(80));

// 1. Category Distribution Analysis
console.log('\n📊 CATEGORY DISTRIBUTION ANALYSIS');
console.log('-'.repeat(80));

db.all(`
    SELECT 
        data_category,
        COUNT(*) as record_count,
        AVG(confidence_score) as avg_confidence,
        MIN(confidence_score) as min_confidence,
        MAX(confidence_score) as max_confidence,
        COUNT(DISTINCT data_type) as data_type_variety,
        COUNT(DISTINCT source_page) as page_variety
    FROM captured_data 
    GROUP BY data_category 
    ORDER BY record_count DESC
`, [], (err, rows) => {
    if (err) {
        console.error('Error:', err);
        return;
    }
    
    rows.forEach(row => {
        console.log(`\n📁 ${row.data_category ? row.data_category.toUpperCase() : 'NULL'}`);
        console.log(`   Records: ${row.record_count}`);
        console.log(`   Confidence: ${(row.avg_confidence * 100).toFixed(1)}% (${(row.min_confidence * 100).toFixed(1)}% - ${(row.max_confidence * 100).toFixed(1)}%)`);
        console.log(`   Data Types: ${row.data_type_variety}`);
        console.log(`   Pages: ${row.page_variety}`);
    });
    
    // 2. Business Value Analysis
    console.log('\n\n💰 BUSINESS VALUE ANALYSIS');
    console.log('-'.repeat(80));
    
    // Check for power consumption data
    db.get(`
        SELECT COUNT(*) as count, AVG(confidence_score) as confidence 
        FROM captured_data 
        WHERE data_category = 'units_consumed' 
        AND (raw_value LIKE '%KWH%' OR raw_value LIKE '%kwh%' OR data_type = 'integer')
    `, [], (err, row) => {
        if (!err && row) {
            console.log(`\n📈 Power Consumption Data:`);
            console.log(`   Records: ${row.count || 0}`);
            console.log(`   Confidence: ${row.confidence ? (row.confidence * 100).toFixed(1) + '%' : 'N/A'}`);
            console.log(`   Value Score: ${calculateValueScore(row.count || 0, row.confidence || 0)}/10`);
        }
    });
    
    // Check for Grid and DG status data
    db.get(`
        SELECT COUNT(*) as count, AVG(confidence_score) as confidence 
        FROM captured_data 
        WHERE data_category IN ('grid_status', 'dg_status') 
        AND data_type = 'status'
    `, [], (err, row) => {
        if (!err && row) {
            console.log(`\n💡 Grid/DG Status Data:`);
            console.log(`   Records: ${row.count || 0}`);
            console.log(`   Confidence: ${row.confidence ? (row.confidence * 100).toFixed(1) + '%' : 'N/A'}`);
            console.log(`   Value Score: ${calculateValueScore(row.count || 0, row.confidence || 0)}/10`);
        }
    });
    
    // Check for monetary values
    db.get(`
        SELECT COUNT(*) as count, AVG(confidence_score) as confidence 
        FROM captured_data 
        WHERE raw_value LIKE '%₹%' OR raw_value LIKE '%rs%' OR raw_value LIKE '%rupee%'
    `, [], (err, row) => {
        if (!err && row) {
            console.log(`\n💰 Monetary Values:`);
            console.log(`   Records: ${row.count || 0}`);
            console.log(`   Confidence: ${row.confidence ? (row.confidence * 100).toFixed(1) + '%' : 'N/A'}`);
            console.log(`   Value Score: ${calculateValueScore(row.count || 0, row.confidence || 0)}/10`);
        }
    });
    
    // 3. Sample High-Value Records
    console.log('\n\n🎯 HIGH-VALUE SAMPLE RECORDS');
    console.log('-'.repeat(80));
    
    db.all(`
        SELECT data_category, raw_value, data_type, confidence_score, context_text
        FROM captured_data 
        WHERE confidence_score > 0.8 OR data_category = 'units_consumed'
        ORDER BY confidence_score DESC
        LIMIT 10
    `, [], (err, samples) => {
        if (!err && samples) {
            samples.forEach((sample, i) => {
                console.log(`\n${i+1}. ${sample.data_category || 'unknown'} | ${sample.raw_value}`);
                console.log(`   Type: ${sample.data_type} | Confidence: ${(sample.confidence_score * 100).toFixed(1)}%`);
                console.log(`   Context: ${sample.context_text ? sample.context_text.substring(0, 60) + '...' : 'N/A'}`);
            });
        }
        
        // 4. Generate Recommendations
        console.log('\n\n🎯 RECOMMENDATIONS');
        console.log('='.repeat(80));
        
        generateRecommendations(rows);
        
        db.close();
    });
});

function calculateValueScore(recordCount, confidence) {
    const recordScore = Math.min(recordCount / 50 * 4, 4); // Max 4 points for volume
    const confidenceScore = confidence * 4; // Max 4 points for confidence  
    const completenessScore = 2; // Base 2 points for having data
    
    return (recordScore + confidenceScore + completenessScore).toFixed(1);
}

function generateRecommendations(categoryData) {
    const recommendations = [];
    
    categoryData.forEach(row => {
        const valueScore = calculateValueScore(row.record_count, row.avg_confidence);
        
        if (row.data_category === 'units_consumed' && row.avg_confidence > 0.9) {
            recommendations.push({
                title: '🔥 HIGHEST PRIORITY: Focus on units_consumed data',
                priority: 'CRITICAL',
                reason: `${(row.avg_confidence * 100).toFixed(1)}% confidence with ${row.record_count} records containing actual power consumption data`,
                action: 'Increase monitoring frequency to every 5 minutes during peak hours'
            });
        }
        
        if (row.data_category === 'dg_status' && row.record_count > 0) {
            recommendations.push({
                title: '🔌 HIGH PRIORITY: Monitor DG status',
                priority: 'HIGH', 
                reason: 'DG availability is critical for backup power monitoring',
                action: 'Set up real-time alerts for DG status changes'
            });
        }
        
        if (row.data_category === 'grid_status' && row.record_count > 0) {
            recommendations.push({
                title: '⚡ HIGH PRIORITY: Monitor Grid status',
                priority: 'HIGH', 
                reason: 'Grid availability monitoring is essential for power outage detection',
                action: 'Set up real-time alerts for Grid status changes'
            });
        }
        
        if (row.data_category === 'voltage' && row.record_count > 0) {
            recommendations.push({
                title: '⚡ HIGH PRIORITY: Monitor voltage data',
                priority: 'HIGH', 
                reason: 'Critical for power quality monitoring and fault detection',
                action: 'Set up alerts for voltage fluctuations outside normal range'
            });
        }
        
        if (row.data_category === 'unknown' && row.record_count > 20) {
            recommendations.push({
                title: '🔍 MEDIUM PRIORITY: Improve unknown data classification',
                priority: 'MEDIUM',
                reason: `${row.record_count} unclassified records may contain valuable data`,
                action: 'Review and add classification rules for unknown patterns'
            });
        }
        
        if (row.data_category === 'grid_status' && row.avg_confidence < 0.5) {
            recommendations.push({
                title: '📊 LOW PRIORITY: Enhance grid_status classification',
                priority: 'LOW',
                reason: 'Low confidence score indicates classification issues',
                action: 'Review and improve pattern matching for grid status'
            });
        }
    });
    
    // Add time-based recommendations
    recommendations.push({
        title: '⏰ Schedule optimized monitoring',
        priority: 'HIGH',
        reason: 'Peak consumption hours need more frequent monitoring',
        action: 'Monitor every 5 min during 6-10 AM & 6-10 PM, every 15 min otherwise'
    });
    
    recommendations.forEach((rec, index) => {
        console.log(`\n${index + 1}. ${rec.title}`);
        console.log(`   Priority: ${rec.priority}`);
        console.log(`   Reason: ${rec.reason}`);
        console.log(`   Action: ${rec.action}`);
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('💡 SUMMARY: Focus on units_consumed and voltage data for maximum business value');
    console.log('⚡ High-frequency monitoring recommended for power consumption patterns');
    console.log('🔧 Consider improving classification rules for "unknown" category');
}