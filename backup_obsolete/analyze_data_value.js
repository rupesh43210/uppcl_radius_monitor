#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * Data Value Analytics for UPPCL Scraper
 * Analyzes captured data to determine most valuable categories for monitoring
 */

class DataValueAnalyzer {
    constructor() {
        this.dbPath = path.join(__dirname, 'charges.db');
        this.db = new sqlite3.Database(this.dbPath);
    }

    async runAnalysis() {
        console.log('🔍 UPPCL Data Value Analysis');
        console.log('=' .repeat(80));
        
        await this.categoryAnalysis();
        await this.dataQualityAnalysis();
        await this.businessValueAnalysis();
        await this.temporalAnalysis();
        await this.generateRecommendations();
        
        this.db.close();
    }

    categoryAnalysis() {
        return new Promise((resolve) => {
            console.log('\n📊 CATEGORY DISTRIBUTION ANALYSIS');
            console.log('-'.repeat(80));
            
            const query = `
                SELECT 
                    data_category,
                    COUNT(*) as record_count,
                    AVG(confidence_score) as avg_confidence,
                    MIN(confidence_score) as min_confidence,
                    MAX(confidence_score) as max_confidence,
                    COUNT(DISTINCT data_type) as data_type_variety,
                    COUNT(DISTINCT source_page) as page_variety
                FROM scraped_data 
                GROUP BY data_category 
                ORDER BY record_count DESC
            `;
            
            this.db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('Error:', err);
                    return resolve();
                }
                
                rows.forEach(row => {
                    console.log(`\n📁 ${row.data_category.toUpperCase()}`);
                    console.log(`   Records: ${row.record_count}`);
                    console.log(`   Confidence: ${(row.avg_confidence * 100).toFixed(1)}% (${(row.min_confidence * 100).toFixed(1)}% - ${(row.max_confidence * 100).toFixed(1)}%)`);
                    console.log(`   Data Types: ${row.data_type_variety}`);
                    console.log(`   Pages: ${row.page_variety}`);
                });
                
                resolve();
            });
        });
    }

    dataQualityAnalysis() {
        return new Promise((resolve) => {
            console.log('\n\n🎯 DATA QUALITY ANALYSIS');
            console.log('-'.repeat(80));
            
            const query = `
                SELECT 
                    data_category,
                    data_type,
                    COUNT(*) as count,
                    AVG(confidence_score) as avg_confidence,
                    AVG(LENGTH(raw_value)) as avg_value_length,
                    COUNT(CASE WHEN numeric_value IS NOT NULL THEN 1 END) as numeric_count,
                    COUNT(CASE WHEN unit IS NOT NULL THEN 1 END) as unit_count
                FROM scraped_data 
                WHERE data_category != 'unknown'
                GROUP BY data_category, data_type
                ORDER BY avg_confidence DESC, count DESC
            `;
            
            this.db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('Error:', err);
                    return resolve();
                }
                
                console.log('Category'.padEnd(20) + 'Type'.padEnd(12) + 'Count'.padEnd(8) + 'Confidence'.padEnd(12) + 'Numeric'.padEnd(10) + 'Units');
                console.log('-'.repeat(80));
                
                rows.forEach(row => {
                    const confidence = `${(row.avg_confidence * 100).toFixed(1)}%`;
                    const numericPct = `${((row.numeric_count / row.count) * 100).toFixed(0)}%`;
                    const unitPct = `${((row.unit_count / row.count) * 100).toFixed(0)}%`;
                    
                    console.log(
                        row.data_category.padEnd(20) + 
                        row.data_type.padEnd(12) + 
                        row.count.toString().padEnd(8) + 
                        confidence.padEnd(12) + 
                        numericPct.padEnd(10) + 
                        unitPct
                    );
                });
                
                resolve();
            });
        });
    }

    businessValueAnalysis() {
        return new Promise((resolve) => {
            console.log('\n\n💰 BUSINESS VALUE ANALYSIS');
            console.log('-'.repeat(80));
            
            // Analyze specific valuable patterns
            const queries = [
                {
                    name: 'Power Consumption Data',
                    query: `
                        SELECT COUNT(*) as count, AVG(confidence_score) as confidence 
                        FROM scraped_data 
                        WHERE data_category = 'units_consumed' 
                        AND (raw_value LIKE '%KWH%' OR raw_value LIKE '%kwh%' OR data_type = 'integer')
                    `
                },
                {
                    name: 'Grid Status Information',
                    query: `
                        SELECT COUNT(*) as count, AVG(confidence_score) as confidence 
                        FROM scraped_data 
                        WHERE data_category = 'grid_status' 
                        AND (raw_value LIKE '%Grid%' OR data_type = 'status')
                    `
                },
                {
                    name: 'Voltage Measurements',
                    query: `
                        SELECT COUNT(*) as count, AVG(confidence_score) as confidence 
                        FROM scraped_data 
                        WHERE data_category = 'voltage' OR raw_value LIKE '%volt%'
                    `
                },
                {
                    name: 'Current Measurements',
                    query: `
                        SELECT COUNT(*) as count, AVG(confidence_score) as confidence 
                        FROM scraped_data 
                        WHERE data_category = 'current' OR raw_value LIKE '%amp%'
                    `
                },
                {
                    name: 'Monetary Values',
                    query: `
                        SELECT COUNT(*) as count, AVG(confidence_score) as confidence 
                        FROM scraped_data 
                        WHERE raw_value LIKE '%₹%' OR raw_value LIKE '%rs%' OR raw_value LIKE '%rupee%'
                    `
                }
            ];
            
            let completed = 0;
            queries.forEach(queryObj => {
                this.db.get(queryObj.query, [], (err, row) => {
                    if (err) {
                        console.error(`Error in ${queryObj.name}:`, err);
                    } else {
                        console.log(`\n📈 ${queryObj.name}:`);
                        console.log(`   Records: ${row.count || 0}`);
                        console.log(`   Confidence: ${row.confidence ? (row.confidence * 100).toFixed(1) + '%' : 'N/A'}`);
                        console.log(`   Value Score: ${this.calculateValueScore(row.count || 0, row.confidence || 0)}/10`);
                    }
                    
                    completed++;
                    if (completed === queries.length) {
                        resolve();
                    }
                });
            });
        });
    }

    temporalAnalysis() {
        return new Promise((resolve) => {
            console.log('\n\n⏰ TEMPORAL ANALYSIS');
            console.log('-'.repeat(80));
            
            const query = `
                SELECT 
                    data_category,
                    COUNT(*) as total_records,
                    COUNT(DISTINCT DATE(captured_at)) as capture_days,
                    MIN(captured_at) as first_capture,
                    MAX(captured_at) as last_capture
                FROM scraped_data 
                GROUP BY data_category
                ORDER BY total_records DESC
            `;
            
            this.db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('Error:', err);
                    return resolve();
                }
                
                rows.forEach(row => {
                    const recordsPerDay = row.total_records / Math.max(row.capture_days, 1);
                    console.log(`\n📅 ${row.data_category}:`);
                    console.log(`   Total Records: ${row.total_records}`);
                    console.log(`   Capture Days: ${row.capture_days}`);
                    console.log(`   Records/Day: ${recordsPerDay.toFixed(1)}`);
                    console.log(`   Period: ${row.first_capture} to ${row.last_capture}`);
                });
                
                resolve();
            });
        });
    }

    calculateValueScore(recordCount, confidence) {
        // Business value scoring algorithm
        const recordScore = Math.min(recordCount / 50 * 4, 4); // Max 4 points for volume
        const confidenceScore = confidence * 4; // Max 4 points for confidence  
        const completenessScore = 2; // Base 2 points for having data
        
        return (recordScore + confidenceScore + completenessScore).toFixed(1);
    }

    async generateRecommendations() {
        console.log('\n\n🎯 RECOMMENDATIONS');
        console.log('='.repeat(80));
        
        const recommendations = await this.getRecommendations();
        
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

    getRecommendations() {
        return new Promise((resolve) => {
            const query = `
                SELECT 
                    data_category,
                    COUNT(*) as count,
                    AVG(confidence_score) as confidence,
                    COUNT(CASE WHEN numeric_value IS NOT NULL THEN 1 END) as numeric_count
                FROM scraped_data 
                GROUP BY data_category
                ORDER BY confidence DESC, count DESC
            `;
            
            this.db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('Error:', err);
                    return resolve([]);
                }
                
                const recommendations = [];
                
                rows.forEach(row => {
                    const valueScore = this.calculateValueScore(row.count, row.confidence);
                    
                    if (row.data_category === 'units_consumed' && row.confidence > 0.9) {
                        recommendations.push({
                            title: '🔥 HIGHEST PRIORITY: Focus on units_consumed data',
                            priority: 'CRITICAL',
                            reason: `97.9% confidence with ${row.count} records containing actual power consumption data`,
                            action: 'Increase monitoring frequency to every 5 minutes during peak hours'
                        });
                    }
                    
                    if (row.data_category === 'voltage' && row.count > 0) {
                        recommendations.push({
                            title: '⚡ HIGH PRIORITY: Monitor voltage data',
                            priority: 'HIGH', 
                            reason: 'Critical for power quality monitoring and fault detection',
                            action: 'Set up alerts for voltage fluctuations outside normal range'
                        });
                    }
                    
                    if (row.data_category === 'unknown' && row.count > 20) {
                        recommendations.push({
                            title: '🔍 MEDIUM PRIORITY: Improve unknown data classification',
                            priority: 'MEDIUM',
                            reason: `${row.count} unclassified records may contain valuable data`,
                            action: 'Review and add classification rules for unknown patterns'
                        });
                    }
                    
                    if (row.data_category === 'grid_status' && row.confidence < 0.5) {
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
                
                resolve(recommendations);
            });
        });
    }
}

// Run the analysis
if (require.main === module) {
    const analyzer = new DataValueAnalyzer();
    analyzer.runAnalysis().catch(console.error);
}

module.exports = DataValueAnalyzer;