#!/usr/bin/env node

const puppeteer = require('puppeteer');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const CONFIG = {
  WEBAPP_URL: process.env.WEBAPP_URL || 'https://uppclmp.myxenius.com/AppAMR',
  USERNAME: process.env.USERNAME,
  PASSWORD: process.env.PASSWORD,
  HEADLESS: process.env.HEADLESS !== 'false'
};

class UPPCLTestScraper {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    console.log('🚀 Starting UPPCL Test Scraper...');
    console.log('🔧 Config:', {
      url: CONFIG.WEBAPP_URL,
      username: CONFIG.USERNAME ? '✓' : '❌',
      password: CONFIG.PASSWORD ? '✓' : '❌',
      headless: CONFIG.HEADLESS
    });

    this.browser = await puppeteer.launch({
      headless: CONFIG.HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 720 });
    
    // Set user agent
    await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
  }

  async login() {
    try {
      console.log('🔐 Attempting login...');
      await this.page.goto(CONFIG.WEBAPP_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      
      console.log('📄 Current page:', this.page.url());
      console.log('📝 Page title:', await this.page.title());

      // Take a screenshot to see what we're working with
      await this.page.screenshot({ path: 'debug_login_page.png', fullPage: true });
      console.log('📸 Screenshot saved as debug_login_page.png');

      // Look for login form elements
      console.log('🔍 Looking for login elements...');
      
      // Try to find username/email field
      const usernameSelectors = [
        'input[name="username"]',
        'input[name="email"]',
        'input[name="UserId"]',
        'input[name="userid"]',
        'input[type="email"]',
        'input[placeholder*="username" i]',
        'input[placeholder*="email" i]',
        'input[placeholder*="user" i]',
        '#username',
        '#email',
        '#userid'
      ];

      let usernameField = null;
      for (const selector of usernameSelectors) {
        try {
          usernameField = await this.page.$(selector);
          if (usernameField) {
            console.log('✅ Found username field:', selector);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      // Try to find password field
      const passwordSelectors = [
        'input[name="password"]',
        'input[name="Password"]',
        'input[type="password"]',
        '#password',
        '#Password'
      ];

      let passwordField = null;
      for (const selector of passwordSelectors) {
        try {
          passwordField = await this.page.$(selector);
          if (passwordField) {
            console.log('✅ Found password field:', selector);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      if (!usernameField || !passwordField) {
        console.log('❌ Could not find login fields');
        
        // Let's see what forms are available
        const forms = await this.page.$$eval('form', forms => 
          forms.map(form => ({
            action: form.action,
            method: form.method,
            inputs: Array.from(form.querySelectorAll('input')).map(input => ({
              name: input.name,
              type: input.type,
              placeholder: input.placeholder,
              id: input.id
            }))
          }))
        );
        
        console.log('📋 Available forms:', JSON.stringify(forms, null, 2));
        
        // Also check all input fields on the page
        const allInputs = await this.page.$$eval('input', inputs => 
          inputs.map(input => ({
            name: input.name,
            type: input.type,
            placeholder: input.placeholder,
            id: input.id,
            className: input.className
          }))
        );
        
        console.log('📋 All input fields:', JSON.stringify(allInputs, null, 2));
        return false;
      }

      // Fill login form
      console.log('✏️ Filling login credentials...');
      await usernameField.type(CONFIG.USERNAME);
      await passwordField.type(CONFIG.PASSWORD);

      // Look for submit button
      const submitSelectors = [
        '#submitBtn',  // Found in the button list
        'button[type="submit"]',
        'input[type="submit"]',
        'button[name="submit"]',
        'button:contains("Submit")',
        'button.btn',
        '.btn',
        'button'  // fallback to any button
      ];

      let submitButton = null;
      for (const selector of submitSelectors) {
        try {
          if (selector.includes(':contains')) {
            // Handle text-based selectors differently
            submitButton = await this.page.$x("//button[contains(text(), 'Submit')]");
            if (submitButton.length > 0) {
              submitButton = submitButton[0];
              console.log('✅ Found submit button with text:', selector);
              break;
            }
          } else {
            submitButton = await this.page.$(selector);
            if (submitButton) {
              console.log('✅ Found submit button:', selector);
              break;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      if (!submitButton) {
        // Try to find any button in the form
        const buttons = await this.page.$$eval('button, input[type="submit"], input[type="button"]', buttons => 
          buttons.map(btn => ({
            text: btn.textContent || btn.value,
            type: btn.type,
            className: btn.className,
            id: btn.id,
            name: btn.name
          }))
        );
        
        console.log('📋 Available buttons:', JSON.stringify(buttons, null, 2));
        
        // Try the first submit-type button
        submitButton = await this.page.$('button[type="submit"], input[type="submit"]');
      }

      if (submitButton) {
        console.log('🔄 Clicking submit button...');
        
        // Click and wait, but handle timeout gracefully
        try {
          await submitButton.click();
          await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        } catch (navError) {
          console.log('⚠️ Navigation timeout, but continuing...');
          // Wait a bit for any delayed responses
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

        console.log('✅ Login submitted, current page:', this.page.url());
        console.log('📝 Current page title:', await this.page.title());
        
        await this.page.screenshot({ path: 'debug_after_login.png', fullPage: true });
        console.log('📸 Post-login screenshot saved as debug_after_login.png');
        
        // Check if we're still on the login page
        const currentUrl = this.page.url();
        if (currentUrl.includes('login')) {
          console.log('⚠️ Still on login page - checking for error messages...');
          
          // Look for error messages
          try {
            const errorMessages = await this.page.$$eval('[class*="error"], [class*="alert"], .text-danger, .text-red', 
              elements => elements.map(el => el.textContent.trim()).filter(text => text.length > 0)
            );
            
            if (errorMessages.length > 0) {
              console.log('❌ Error messages found:', errorMessages);
              return false;
            }
          } catch (e) {
            console.log('⚠️ No error messages found');
          }
          
          // Check if there are additional form fields (like CAPTCHA)
          const additionalFields = await this.page.$$eval('input:not([type="hidden"])', 
            inputs => inputs.map(input => ({
              name: input.name,
              type: input.type,
              placeholder: input.placeholder,
              required: input.required
            }))
          );
          
          console.log('📋 All form fields after submit:', JSON.stringify(additionalFields, null, 2));
          
          return false;
        }
        
        return true;
      } else {
        console.log('❌ Could not find submit button');
        return false;
      }

    } catch (error) {
      console.error('❌ Login failed:', error.message);
      return false;
    }
  }

  async extractData() {
    try {
      console.log('🔍 Extracting data from current page...');
      
      // Get page title and URL
      const title = await this.page.title();
      const url = this.page.url();
      console.log('📄 Current page:', title, '-', url);

      // Extract all text content that might contain numeric values
      const extractedData = await this.page.evaluate(() => {
        const results = [];
        
        // Currency regex patterns
        const currencyRegex = /(₹|Rs\.?|INR)\s*-?\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?/gi;
        
        // Number with unit regex
        const numberUnitRegex = /(-?\d+(?:\.\d+)?)(?:\s*(kwh|kW|W|A|V|units|m3|kVA|kWhr|%)?)/gi;
        
        // Status words
        const statusRegex = /\b(on|off|connected|disconnected|grid|dg|running|stopped|charging|idle|active|inactive)\b/gi;
        
        // Date/time patterns
        const dateTimeRegex = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?/gi;

        // Get all visible text elements
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: function(node) {
              // Skip script and style tags
              const parent = node.parentElement;
              if (!parent) return NodeFilter.FILTER_REJECT;
              
              const tagName = parent.tagName.toLowerCase();
              if (['script', 'style', 'noscript'].includes(tagName)) {
                return NodeFilter.FILTER_REJECT;
              }
              
              // Skip hidden elements
              const style = window.getComputedStyle(parent);
              if (style.display === 'none' || style.visibility === 'hidden') {
                return NodeFilter.FILTER_REJECT;
              }
              
              // Only include text nodes with actual content
              const text = node.textContent.trim();
              if (text.length === 0) return NodeFilter.FILTER_REJECT;
              
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );

        let node;
        const processedElements = new Set();
        
        while (node = walker.nextNode()) {
          const element = node.parentElement;
          if (processedElements.has(element)) continue;
          processedElements.add(element);
          
          const text = element.textContent.trim();
          if (text.length < 2) continue;
          
          // Extract matches
          let matches = [];
          
          // Currency matches
          const currencyMatches = text.match(currencyRegex);
          if (currencyMatches) {
            currencyMatches.forEach(match => {
              matches.push({
                type: 'currency',
                value: match,
                context: text.substring(Math.max(0, text.indexOf(match) - 50), text.indexOf(match) + match.length + 50)
              });
            });
          }
          
          // Number/unit matches
          const numberMatches = text.match(numberUnitRegex);
          if (numberMatches) {
            numberMatches.forEach(match => {
              // Skip if it's just a year or small number without context
              if (/^\d{1,2}$/.test(match) || /^\d{4}$/.test(match)) return;
              
              matches.push({
                type: 'number_unit',
                value: match,
                context: text.substring(Math.max(0, text.indexOf(match) - 50), text.indexOf(match) + match.length + 50)
              });
            });
          }
          
          // Status matches
          const statusMatches = text.match(statusRegex);
          if (statusMatches) {
            statusMatches.forEach(match => {
              matches.push({
                type: 'status',
                value: match,
                context: text.substring(Math.max(0, text.indexOf(match) - 50), text.indexOf(match) + match.length + 50)
              });
            });
          }
          
          // DateTime matches
          const dateMatches = text.match(dateTimeRegex);
          if (dateMatches) {
            dateMatches.forEach(match => {
              matches.push({
                type: 'datetime',
                value: match,
                context: text.substring(Math.max(0, text.indexOf(match) - 50), text.indexOf(match) + match.length + 50)
              });
            });
          }
          
          if (matches.length > 0) {
            const elementPath = this.getElementPath(element);
            matches.forEach(match => {
              results.push({
                ...match,
                dom_path: elementPath,
                full_text: text
              });
            });
          }
        }
        
        return results;
      });

      console.log(`🎯 Found ${extractedData.length} potential data points:`);
      
      extractedData.forEach((item, index) => {
        console.log(`\n${index + 1}. Type: ${item.type}`);
        console.log(`   Value: "${item.value}"`);
        console.log(`   Context: "${item.context}"`);
        console.log(`   DOM Path: ${item.dom_path}`);
      });

      return extractedData;

    } catch (error) {
      console.error('❌ Data extraction failed:', error.message);
      return [];
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      console.log('🧹 Browser closed');
    }
  }
}

// Add helper function to the page context
async function addHelperFunctions(page) {
  await page.evaluateOnNewDocument(() => {
    window.getElementPath = function(element) {
      const names = [];
      while (element.parentNode) {
        if (element.id) {
          names.unshift('#' + element.id);
          break;
        } else {
          let tagName = element.nodeName.toLowerCase();
          if (element.className) {
            tagName += '.' + element.className.split(' ').join('.');
          }
          names.unshift(tagName);
          element = element.parentNode;
        }
      }
      return names.join(' > ');
    };
  });
}

// Main execution
async function main() {
  const scraper = new UPPCLTestScraper();
  
  try {
    await scraper.initialize();
    await addHelperFunctions(scraper.page);
    
    const loginSuccess = await scraper.login();
    
    if (loginSuccess) {
      console.log('✅ Login successful! Proceeding to extract data...');
      const data = await scraper.extractData();
      
      if (data.length > 0) {
        console.log('\n🎉 SUCCESS! We can extract data from the UPPCL portal!');
        console.log(`📊 Total data points found: ${data.length}`);
        
        // Group by type
        const byType = data.reduce((acc, item) => {
          acc[item.type] = (acc[item.type] || 0) + 1;
          return acc;
        }, {});
        
        console.log('\n📈 Data breakdown by type:');
        Object.entries(byType).forEach(([type, count]) => {
          console.log(`   ${type}: ${count} items`);
        });
        
      } else {
        console.log('⚠️ No data found - might need to navigate to specific pages');
      }
    } else {
      console.log('❌ Login failed - please check credentials and page structure');
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