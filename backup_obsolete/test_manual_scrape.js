#!/usr/bin/env node

const puppeteer = require('puppeteer');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const CONFIG = {
  WEBAPP_URL: process.env.WEBAPP_URL || 'https://uppclmp.myxenius.com/AppAMR',
  USERNAME: process.env.USERNAME,
  PASSWORD: process.env.PASSWORD,
  HEADLESS: false  // Always run in visible mode for manual CAPTCHA
};

class UPPCLManualTestScraper {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    console.log('🚀 Starting UPPCL Manual Test Scraper...');
    console.log('👁️ Running in VISIBLE mode - you will need to solve CAPTCHA manually');
    console.log('🔧 Config:', {
      url: CONFIG.WEBAPP_URL,
      username: CONFIG.USERNAME ? '✓' : '❌',
      password: CONFIG.PASSWORD ? '✓' : '❌'
    });

    this.browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 720 });
    await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
  }

  async setupManualLogin() {
    try {
      console.log('🔐 Setting up login page...');
      await this.page.goto(CONFIG.WEBAPP_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      
      console.log('📄 Current page:', this.page.url());

      // Fill username and password automatically
      const usernameField = await this.page.$('input[placeholder*="username" i]');
      const passwordField = await this.page.$('input[type="password"]');

      if (usernameField && passwordField) {
        console.log('✅ Filling username and password...');
        await usernameField.type(CONFIG.USERNAME);
        await passwordField.type(CONFIG.PASSWORD);
        console.log('✅ Credentials filled - now solve the CAPTCHA manually and click Submit');
      }

      return true;
    } catch (error) {
      console.error('❌ Setup failed:', error.message);
      return false;
    }
  }

  async waitForLogin() {
    console.log('⏳ Waiting for you to complete CAPTCHA and login...');
    console.log('📝 Instructions:');
    console.log('   1. Look at the browser window that opened');
    console.log('   2. Enter the CAPTCHA code');
    console.log('   3. Click the Submit button');
    console.log('   4. Wait for the page to load');
    console.log('');
    console.log('⌨️ Press ENTER in this terminal once you are logged in and see the dashboard...');

    // Wait for user input
    await new Promise(resolve => {
      process.stdin.once('data', () => {
        resolve();
      });
    });

    console.log('✅ Proceeding to test data extraction...');
    return true;
  }

  async extractDataFromCurrentPage() {
    try {
      console.log('🔍 Extracting data from current page...');
      
      const title = await this.page.title();
      const url = this.page.url();
      console.log('📄 Current page:', title, '-', url);

      // Extract all potential data
      const extractedData = await this.page.evaluate(() => {
        const results = [];
        
        // Get all text content on the page
        const allText = document.body.innerText;
        console.log('Page text preview:', allText.substring(0, 500) + '...');
        
        // Comprehensive regex patterns
        const patterns = {
          currency: /(₹|Rs\.?\s*|INR\s*)-?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?/gi,
          number_with_unit: /(-?\d+(?:\.\d+)?)\s*(kwh|kW|W|A|V|units|m3|kVA|kWhr|%|volt|amp|watt)/gi,
          percentage: /\d+(?:\.\d+)?\s*%/gi,
          decimal_numbers: /\d+\.\d{2,}/g,
          large_numbers: /\d{3,}/g,
          status_words: /\b(on|off|connected|disconnected|grid|dg|running|stopped|charging|idle|active|inactive|online|offline)\b/gi,
          dates: /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g,
          times: /\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?/gi
        };

        // Find all table cells and divs that might contain data
        const potentialDataElements = document.querySelectorAll('td, th, div, span, p, strong, b');
        
        potentialDataElements.forEach((element, index) => {
          if (index > 500) return; // Limit processing to avoid timeout
          
          const text = element.innerText?.trim() || '';
          if (text.length < 2 || text.length > 200) return;
          
          // Check each pattern
          Object.entries(patterns).forEach(([patternName, regex]) => {
            const matches = text.match(regex);
            if (matches) {
              matches.forEach(match => {
                // Get element path
                let path = '';
                try {
                  const tagName = element.tagName.toLowerCase();
                  const className = element.className ? '.' + element.className.split(' ').join('.') : '';
                  const id = element.id ? '#' + element.id : '';
                  path = tagName + id + className;
                } catch (e) {
                  path = element.tagName || 'unknown';
                }
                
                results.push({
                  type: patternName,
                  value: match,
                  context: text,
                  dom_path: path,
                  element_tag: element.tagName
                });
              });
            }
          });
        });
        
        // Also look for common data patterns in specific contexts
        const commonKeywords = ['charge', 'bill', 'amount', 'units', 'consumption', 'grid', 'dg', 'generator', 'power', 'voltage', 'current', 'status'];
        
        commonKeywords.forEach(keyword => {
          const elements = Array.from(document.querySelectorAll('*')).filter(el => {
            const text = el.innerText?.toLowerCase() || '';
            return text.includes(keyword) && text.length < 100;
          });
          
          elements.slice(0, 10).forEach(el => { // Limit to first 10 matches per keyword
            const text = el.innerText?.trim() || '';
            if (text && text.length > 0) {
              results.push({
                type: 'keyword_context',
                value: keyword,
                context: text,
                dom_path: el.tagName.toLowerCase(),
                element_tag: el.tagName
              });
            }
          });
        });
        
        return results;
      });

      console.log(`🎯 Found ${extractedData.length} potential data points:`);
      
      // Group and display results
      const byType = extractedData.reduce((acc, item) => {
        acc[item.type] = acc[item.type] || [];
        acc[item.type].push(item);
        return acc;
      }, {});

      Object.entries(byType).forEach(([type, items]) => {
        console.log(`\n📊 ${type.toUpperCase()} (${items.length} items):`);
        items.slice(0, 5).forEach((item, index) => {
          console.log(`   ${index + 1}. "${item.value}" in context: "${item.context.substring(0, 80)}..."`);
        });
        if (items.length > 5) {
          console.log(`   ... and ${items.length - 5} more`);
        }
      });

      return extractedData;

    } catch (error) {
      console.error('❌ Data extraction failed:', error.message);
      return [];
    }
  }

  async exploreDashboard() {
    console.log('🗺️ Let\'s explore different sections of the dashboard...');
    
    // Look for navigation links
    const links = await this.page.$$eval('a, button', elements => 
      elements.map(el => ({
        text: el.innerText?.trim() || el.textContent?.trim() || '',
        href: el.href || '',
        tag: el.tagName
      })).filter(link => link.text.length > 0 && link.text.length < 50)
    );

    console.log('\n🔗 Available navigation options:');
    links.slice(0, 20).forEach((link, index) => {
      console.log(`   ${index + 1}. "${link.text}" (${link.tag})`);
    });

    console.log('\n⚡ Quick data extraction from current page:');
    const currentPageData = await this.extractDataFromCurrentPage();
    
    return currentPageData;
  }

  async cleanup() {
    console.log('\n🔄 Keep browser open for manual exploration? (y/n)');
    
    const keepOpen = await new Promise(resolve => {
      process.stdin.once('data', (data) => {
        const input = data.toString().trim().toLowerCase();
        resolve(input === 'y' || input === 'yes');
      });
    });

    if (!keepOpen) {
      if (this.browser) {
        await this.browser.close();
        console.log('🧹 Browser closed');
      }
    } else {
      console.log('🌐 Browser kept open for manual exploration');
      console.log('📝 You can manually navigate and test the data extraction');
    }
  }
}

// Main execution
async function main() {
  const scraper = new UPPCLManualTestScraper();
  
  try {
    await scraper.initialize();
    
    const setupSuccess = await scraper.setupManualLogin();
    
    if (setupSuccess) {
      await scraper.waitForLogin();
      const data = await scraper.exploreDashboard();
      
      if (data.length > 0) {
        console.log('\n🎉 SUCCESS! We can extract data from the UPPCL portal!');
        console.log(`📊 Total data points found: ${data.length}`);
        
        // Provide summary
        const summary = data.reduce((acc, item) => {
          acc[item.type] = (acc[item.type] || 0) + 1;
          return acc;
        }, {});
        
        console.log('\n📈 Data extraction summary:');
        Object.entries(summary).forEach(([type, count]) => {
          console.log(`   ${type}: ${count} items`);
        });
        
        console.log('\n✅ The scraping functionality is working!');
        console.log('📋 Next steps:');
        console.log('   1. We can implement auto-CAPTCHA solving (if needed)');
        console.log('   2. Add the database storage functionality');
        console.log('   3. Set up the automatic scheduling');
        
      } else {
        console.log('⚠️ No data found - might need to navigate to specific sections');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await scraper.cleanup();
  }
}

// Run the test
if (require.main === module) {
  main().catch(console.error);
}