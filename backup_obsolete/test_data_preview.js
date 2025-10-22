#!/usr/bin/env node

const UppclScraper = require('./scrape_auto.js');

/**
 * Test mode for Grid/DG and consumption data extraction
 * Shows cleaned data without saving to database
 */

class DataPreviewScraper extends UppclScraper {
  constructor() {
    super();
    this.previewMode = true;
  }

  // Override LED monitoring to just show data
  async monitorLEDStatus() {
    try {
      console.log('🔍 Monitoring Grid and DG LED status...');
      
      const currentUrl = this.page.url();
      const capturedAt = new Date().toISOString();
      
      // Look for LED status indicators and consumption data
      const ledStatusData = await this.page.evaluate(() => {
        const results = [];
        const timestamp = new Date().toISOString();
        
        console.log('🔍 Scanning for Grid LEDs...');
        // Look for Grid LED status and consumption
        const gridLeds = document.querySelectorAll('img[title*="Grid" i], img[alt*="Grid" i]');
        console.log(`Found ${gridLeds.length} Grid LED elements`);
        
        gridLeds.forEach((led, index) => {
          const src = led.src || led.getAttribute('src') || '';
          const title = led.title || led.alt || 'Grid';
          
          console.log(`Grid LED ${index + 1}: src="${src}", title="${title}"`);
          
          let status = 'unknown';
          let confidence = 0.8;
          
          // Determine status based on LED image
          if (src.includes('green-led') || src.includes('green') || src.includes('on')) {
            status = 'online';
            confidence = 1.0;
          } else if (src.includes('red-led') || src.includes('red') || src.includes('off')) {
            status = 'offline';
            confidence = 1.0;
          } else if (src.includes('yellow-led') || src.includes('yellow') || src.includes('warning')) {
            status = 'warning';
            confidence = 0.9;
          }
          
          // Get context text around the LED and look for consumption data
          let contextText = title;
          let consumptionData = null;
          
          // Look in parent elements for consumption information
          let current = led.parentElement;
          let levels = 0;
          while (current && levels < 5) {
            const text = current.textContent || current.innerText || '';
            contextText = text.trim().substring(0, 200);
            
            // Look for Grid consumption patterns: "Grid: 166.00 KWH" or "Grid 166.00 KWH"
            const gridConsumptionMatch = text.match(/Grid[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh|units?)/i);
            if (gridConsumptionMatch) {
              consumptionData = {
                value: parseFloat(gridConsumptionMatch[1]),
                unit: gridConsumptionMatch[2].toUpperCase(),
                source: 'grid',
                period: 'monthly' // Default assumption
              };
              console.log(`Found Grid consumption: ${consumptionData.value} ${consumptionData.unit}`);
            }
            
            // Look for monthly consumption text
            if (text.toLowerCase().includes('month') && text.toLowerCase().includes('consumption')) {
              if (consumptionData) {
                consumptionData.period = 'monthly';
              }
            }
            
            current = current.parentElement;
            levels++;
          }
          
          // Add status record
          results.push({
            category: 'grid_availability',
            value: status,
            type: 'status',
            context: contextText,
            confidence: confidence,
            title: title,
            powerSource: 'grid',
            ledSrc: src
          });
          
          // Add consumption record if found
          if (consumptionData) {
            results.push({
              category: 'grid_consumption',
              value: `${consumptionData.value} ${consumptionData.unit}`,
              type: 'consumption',
              context: contextText,
              confidence: 1.0,
              title: `Grid ${consumptionData.period} Consumption`,
              powerSource: 'grid',
              numericValue: consumptionData.value,
              unit: consumptionData.unit,
              period: consumptionData.period
            });
          }
        });
        
        console.log('🔍 Scanning for DG LEDs...');
        // Look for DG (Diesel Generator) LED status and consumption
        const dgLeds = document.querySelectorAll('img[title*="DG" i], img[alt*="DG" i], img[title*="Generator" i], img[alt*="Generator" i]');
        console.log(`Found ${dgLeds.length} DG LED elements`);
        
        dgLeds.forEach((led, index) => {
          const src = led.src || led.getAttribute('src') || '';
          const title = led.title || led.alt || 'DG';
          
          console.log(`DG LED ${index + 1}: src="${src}", title="${title}"`);
          
          let status = 'unknown';
          let confidence = 0.8;
          
          // Determine status based on LED image
          if (src.includes('green-led') || src.includes('green') || src.includes('on')) {
            status = 'online';
            confidence = 1.0;
          } else if (src.includes('red-led') || src.includes('red') || src.includes('off')) {
            status = 'offline';
            confidence = 1.0;
          } else if (src.includes('yellow-led') || src.includes('yellow') || src.includes('warning')) {
            status = 'warning';
            confidence = 0.9;
          }
          
          // Get context text and look for DG consumption data
          let contextText = title;
          let consumptionData = null;
          
          let current = led.parentElement;
          let levels = 0;
          while (current && levels < 5) {
            const text = current.textContent || current.innerText || '';
            contextText = text.trim().substring(0, 200);
            
            // Look for DG consumption patterns: "DG: 25.50 KWH" or "Generator 25.50 KWH"
            const dgConsumptionMatch = text.match(/(?:DG|Generator)[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh|units?)/i);
            if (dgConsumptionMatch) {
              consumptionData = {
                value: parseFloat(dgConsumptionMatch[1]),
                unit: dgConsumptionMatch[2].toUpperCase(),
                source: 'dg',
                period: 'monthly'
              };
              console.log(`Found DG consumption: ${consumptionData.value} ${consumptionData.unit}`);
            }
            
            // Check for daily consumption
            if (text.toLowerCase().includes('daily') || text.toLowerCase().includes('today')) {
              if (consumptionData) {
                consumptionData.period = 'daily';
              }
            }
            
            current = current.parentElement;
            levels++;
          }
          
          // Add status record
          results.push({
            category: 'dg_availability',
            value: status,
            type: 'status',
            context: contextText,
            confidence: confidence,
            title: title,
            powerSource: 'dg',
            ledSrc: src
          });
          
          // Add consumption record if found
          if (consumptionData) {
            results.push({
              category: 'dg_consumption',
              value: `${consumptionData.value} ${consumptionData.unit}`,
              type: 'consumption',
              context: contextText,
              confidence: 1.0,
              title: `DG ${consumptionData.period} Consumption`,
              powerSource: 'dg',
              numericValue: consumptionData.value,
              unit: consumptionData.unit,
              period: consumptionData.period
            });
          }
        });
        
        console.log('🔍 Scanning page text for consumption patterns...');
        // Look for consumption data throughout the page (not just near LEDs)
        const allText = document.body.innerText || document.body.textContent || '';
        
        // Enhanced consumption pattern matching
        const consumptionPatterns = [
          // Monthly patterns: "Grid: 166.00 KWH", "Month Consumption Grid:166.00 KWH"
          {
            regex: /(?:Month|Monthly).*?(?:Consumption|Usage).*?Grid[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh|units?)/gi,
            source: 'grid',
            period: 'monthly'
          },
          {
            regex: /Grid[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh|units?).*?(?:Month|Monthly)/gi,
            source: 'grid', 
            period: 'monthly'
          },
          {
            regex: /(?:Month|Monthly).*?(?:Consumption|Usage).*?(?:DG|Generator)[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh|units?)/gi,
            source: 'dg',
            period: 'monthly'
          },
          {
            regex: /(?:DG|Generator)[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh|units?).*?(?:Month|Monthly)/gi,
            source: 'dg',
            period: 'monthly'
          },
          // Daily patterns
          {
            regex: /(?:Daily|Today).*?(?:Consumption|Usage).*?Grid[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh|units?)/gi,
            source: 'grid',
            period: 'daily'
          },
          {
            regex: /(?:Daily|Today).*?(?:Consumption|Usage).*?(?:DG|Generator)[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh|units?)/gi,
            source: 'dg',
            period: 'daily'
          },
          // Live/Current patterns
          {
            regex: /(?:Current|Live|Real.?time).*?(?:Consumption|Usage|Load)[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh|W|kW|units?)/gi,
            source: 'live',
            period: 'current'
          }
        ];
        
        let patternMatches = 0;
        consumptionPatterns.forEach((pattern, patternIndex) => {
          let match;
          pattern.regex.lastIndex = 0;
          
          while ((match = pattern.regex.exec(allText)) !== null) {
            const value = parseFloat(match[1]);
            const unit = match[2].toUpperCase();
            
            // Skip very small values that are likely not consumption data
            if (value < 0.1) continue;
            
            patternMatches++;
            console.log(`Pattern ${patternIndex + 1} match: ${pattern.source} ${value} ${unit} (${pattern.period})`);
            
            // Get context around the match
            const matchIndex = match.index;
            const contextStart = Math.max(0, matchIndex - 100);
            const contextEnd = Math.min(allText.length, matchIndex + match[0].length + 100);
            const context = allText.substring(contextStart, contextEnd).trim();
            
            const category = `${pattern.source}_consumption`;
            
            results.push({
              category: category,
              value: `${value} ${unit}`,
              type: 'consumption',
              context: context,
              confidence: 0.95,
              title: `${pattern.source.toUpperCase()} ${pattern.period} Consumption`,
              powerSource: pattern.source,
              numericValue: value,
              unit: unit,
              period: pattern.period
            });
          }
        });
        
        console.log(`Found ${patternMatches} consumption pattern matches`);
        
        return results;
      });
      
      return ledStatusData;
      
    } catch (error) {
      console.error('❌ LED status monitoring failed:', error);
      return [];
    }
  }

  // Override saveToDatabase to just preview
  async saveToDatabase(record) {
    // Don't save, just return a fake ID
    return Math.floor(Math.random() * 1000);
  }

  // Preview mode scraping
  async performPreviewScrape() {
    try {
      console.log('🔍 PREVIEW MODE - Extracting Grid/DG and Consumption Data');
      console.log('=' .repeat(80));
      
      if (!this.browser) {
        await this.initializeBrowser();
      }

      await this.loadCookies();
      
      // Login
      const loginSuccess = await this.login();
      if (!loginSuccess) {
        throw new Error('Login failed');
      }

      console.log('\n📊 Extracting LED Status and Consumption Data...');
      const ledData = await this.monitorLEDStatus();
      
      console.log('\n' + '='.repeat(80));
      console.log('📋 EXTRACTED DATA SUMMARY');
      console.log('='.repeat(80));
      
      // Group data by category
      const groupedData = {};
      ledData.forEach(item => {
        if (!groupedData[item.category]) {
          groupedData[item.category] = [];
        }
        groupedData[item.category].push(item);
      });
      
      // Display grouped data
      Object.keys(groupedData).forEach(category => {
        console.log(`\n📂 ${category.toUpperCase()} (${groupedData[category].length} items)`);
        console.log('-'.repeat(60));
        
        groupedData[category].forEach((item, index) => {
          console.log(`\n   ${index + 1}. ${item.title || item.category}`);
          console.log(`      Value: ${item.value}`);
          console.log(`      Type: ${item.type}`);
          console.log(`      Power Source: ${item.powerSource}`);
          console.log(`      Confidence: ${(item.confidence * 100).toFixed(1)}%`);
          if (item.period) console.log(`      Period: ${item.period}`);
          if (item.numericValue) console.log(`      Numeric: ${item.numericValue} ${item.unit || ''}`);
          if (item.ledSrc) console.log(`      LED Source: ${item.ledSrc}`);
          console.log(`      Context: ${item.context.substring(0, 100)}${item.context.length > 100 ? '...' : ''}`);
        });
      });
      
      console.log('\n' + '='.repeat(80));
      console.log('💡 INSIGHTS:');
      
      // Generate insights
      const gridStatus = ledData.filter(d => d.category === 'grid_availability');
      const dgStatus = ledData.filter(d => d.category === 'dg_availability');
      const gridConsumption = ledData.filter(d => d.category === 'grid_consumption');
      const dgConsumption = ledData.filter(d => d.category === 'dg_consumption');
      
      console.log(`   • Grid Status: ${gridStatus.length} indicators found`);
      if (gridStatus.length > 0) {
        console.log(`     Current Grid Status: ${gridStatus[0].value}`);
      }
      
      console.log(`   • DG Status: ${dgStatus.length} indicators found`);
      if (dgStatus.length > 0) {
        console.log(`     Current DG Status: ${dgStatus[0].value}`);
      }
      
      console.log(`   • Grid Consumption: ${gridConsumption.length} records found`);
      gridConsumption.forEach(gc => {
        console.log(`     ${gc.period} Grid: ${gc.value}`);
      });
      
      console.log(`   • DG Consumption: ${dgConsumption.length} records found`);
      dgConsumption.forEach(dc => {
        console.log(`     ${dc.period} DG: ${dc.value}`);
      });
      
      console.log('\n' + '='.repeat(80));
      console.log('🎯 RECOMMENDATIONS:');
      console.log('   1. Monitor LED status changes every 2-3 minutes');
      console.log('   2. Track consumption data hourly during peak times');
      console.log('   3. Set up alerts for Grid failures and DG starts');
      console.log('   4. Store historical data for reliability analysis');
      
      return ledData;

    } catch (error) {
      console.error('❌ Preview scrape failed:', error.message);
      return [];
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }
}

// Run preview mode
if (require.main === module) {
  const previewScraper = new DataPreviewScraper();
  previewScraper.performPreviewScrape()
    .then(data => {
      console.log(`\n✅ Preview completed. Found ${data.length} data points.`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Preview failed:', error);
      process.exit(1);
    });
}

module.exports = DataPreviewScraper;