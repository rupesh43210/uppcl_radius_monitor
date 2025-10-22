const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CaptchaSolver = require('./captcha_solver');
require('dotenv').config();

// Configuration from environment
const CONFIG = {
  WEBAPP_URL: process.env.WEBAPP_URL || 'https://uppclmp.myxenius.com/AppAMR',
  USERNAME: process.env.USERNAME,
  PASSWORD: process.env.PASSWORD,
  CHARGES_PAGE: process.env.CHARGES_PAGE || '',
  DB_PATH: process.env.DB_PATH || './charges.db',
  HEADLESS: process.env.HEADLESS !== 'false',
  CHECK_INTERVAL_CRON: process.env.CHECK_INTERVAL_CRON || '*/15 * * * *',
  COOKIES_PATH: './cookies.json',
  MAX_ELEMENTS_TO_SCAN: 500,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 2000,
  AUTO_SOLVE_CAPTCHA: process.env.AUTO_SOLVE_CAPTCHA !== 'false',
  CAPTCHA_DEBUG: process.env.CAPTCHA_DEBUG === 'true'
};

// Validation
if (!CONFIG.USERNAME || !CONFIG.PASSWORD) {
  console.error('❌ USERNAME and PASSWORD must be set in .env file');
  process.exit(1);
}

// Regular expressions for value detection
const PATTERNS = {
  currency: /(₹|Rs\.?|INR)\s*-?\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?/gi,
  numberWithUnit: /(-?\d+(?:\.\d+)?)(?:\s*(kwh|kW|W|A|V|units|m3|kVA|kWhr|Hz|°C|C)?)\b/gi,
  percentage: /\d+(?:\.\d+)?\s*%/gi,
  datetime: /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|\d{2,4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM))?/gi,
  status: /\b(on|off|connected|disconnected|grid|dg|running|stopped|charging|idle|active|inactive|normal|fault|alarm)\b/gi
};

// Classification keywords and their categories
const CLASSIFICATION_RULES = {
  dg_charge: ['dg', 'd.g.', 'diesel', 'generator', 'genset', 'backup'],
  electricity_charge: ['electricity', 'electric', 'power', 'energy', 'bill', 'tariff'],
  grid_status: ['grid', 'feeder', 'mains', 'utility', 'supply'],
  units_consumed: ['kwh', 'units', 'consumption', 'consumed', 'usage', 'meter'],
  voltage: ['voltage', 'volt', 'v', 'kv'],
  current: ['current', 'amp', 'ampere', 'a'],
  temperature: ['temperature', 'temp', '°c', 'celsius'],
  frequency: ['frequency', 'freq', 'hz'],
  consumption_report: ['report', 'summary', 'total', 'daily', 'monthly'],
  status: ['status', 'state', 'condition', 'mode']
};

class UPPCLScraper {
  constructor() {
    this.browser = null;
    this.page = null;
    this.db = null;
    this.captchaSolver = null;
    this.initializeDatabase();
  }

  // Initialize SQLite database with proper schema
  initializeDatabase() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(CONFIG.DB_PATH, (err) => {
        if (err) {
          console.error('❌ Error opening database:', err.message);
          reject(err);
          return;
        }
        console.log('✅ Connected to SQLite database');

        const createTableSQL = `
          CREATE TABLE IF NOT EXISTS captured_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            captured_at TEXT NOT NULL,
            source_page TEXT NOT NULL,
            dom_path TEXT,
            context_text TEXT,
            raw_value TEXT NOT NULL,
            data_category TEXT,
            data_type TEXT,
            numeric_value REAL,
            unit TEXT,
            parsed_ts TEXT,
            fingerprint TEXT UNIQUE,
            metadata TEXT,
            confidence_score REAL DEFAULT 0.0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `;

        this.db.run(createTableSQL, (err) => {
          if (err) {
            console.error('❌ Error creating table:', err.message);
            reject(err);
            return;
          }
          console.log('✅ Database table ready');

          // Create indexes for performance
          const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_captured_at ON captured_data(captured_at)',
            'CREATE INDEX IF NOT EXISTS idx_data_category ON captured_data(data_category)',
            'CREATE INDEX IF NOT EXISTS idx_fingerprint ON captured_data(fingerprint)',
            'CREATE INDEX IF NOT EXISTS idx_source_page ON captured_data(source_page)'
          ];

          let indexCount = 0;
          const totalIndexes = indexes.length;

          if (totalIndexes === 0) {
            resolve();
            return;
          }

          indexes.forEach(indexSQL => {
            this.db.run(indexSQL, (err) => {
              if (err) {
                console.error('❌ Error creating index:', err.message);
              }
              indexCount++;
              if (indexCount === totalIndexes) {
                resolve();
              }
            });
          });
        });
      });
    });
  }

  // Save or load cookies for session persistence
  async saveCookies() {
    try {
      const cookies = await this.page.cookies();
      fs.writeFileSync(CONFIG.COOKIES_PATH, JSON.stringify(cookies, null, 2));
      console.log('💾 Cookies saved');
    } catch (error) {
      console.warn('⚠️ Could not save cookies:', error.message);
    }
  }

  async loadCookies() {
    try {
      if (fs.existsSync(CONFIG.COOKIES_PATH)) {
        const cookies = JSON.parse(fs.readFileSync(CONFIG.COOKIES_PATH, 'utf8'));
        await this.page.setCookie(...cookies);
        console.log('🍪 Cookies loaded');
        return true;
      }
    } catch (error) {
      console.warn('⚠️ Could not load cookies:', error.message);
    }
    return false;
  }

  // Initialize browser and page
  async initializeBrowser() {
    try {
      // Initialize CAPTCHA solver if auto-solving is enabled
      if (CONFIG.AUTO_SOLVE_CAPTCHA) {
        this.captchaSolver = new CaptchaSolver({
          debug: CONFIG.CAPTCHA_DEBUG,
          maxAttempts: 3,
          confidence: 0.7
        });
        console.log('🔤 CAPTCHA solver initialized');
      }

      this.browser = await puppeteer.launch({
        headless: CONFIG.HEADLESS,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });

      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1200, height: 800 });
      
      // Set user agent to avoid detection
      await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      console.log('🚀 Browser initialized');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize browser:', error.message);
      return false;
    }
  }

  // Login to the website with CAPTCHA support
  async login() {
    try {
      console.log('🔐 Attempting login...');
      await this.page.goto(CONFIG.WEBAPP_URL, { waitUntil: 'networkidle2', timeout: 30000 });

      // Check if already logged in by looking for dashboard elements
      const isLoggedIn = await this.checkIfLoggedIn();
      if (isLoggedIn) {
        console.log('✅ Already logged in');
        return true;
      }

      // Find login fields
      const usernameField = await this.findUsernameField();
      const passwordField = await this.findPasswordField();
      const captchaField = await this.findCaptchaField();

      if (!usernameField || !passwordField) {
        throw new Error('Could not find login fields');
      }

      // Fill credentials
      console.log('✏️ Filling username and password...');
      await this.page.type(usernameField, CONFIG.USERNAME);
      await this.page.type(passwordField, CONFIG.PASSWORD);

      // Handle CAPTCHA if present - with multiple retry attempts
      if (captchaField) {
        console.log('🔍 CAPTCHA field detected');
        
        if (CONFIG.AUTO_SOLVE_CAPTCHA && this.captchaSolver) {
          console.log('🤖 Auto-solving CAPTCHA with enhanced retry logic...');
          
          // Try up to 5 attempts for CAPTCHA solving
          const captchaText = await this.captchaSolver.solveCaptchaWithRetries(this.page, captchaField, 5);
          
          if (!captchaText) {
            throw new Error('Failed to solve CAPTCHA after multiple attempts');
          }
          
          console.log(`✅ CAPTCHA solved: "${captchaText}"`);
        } else {
          throw new Error('CAPTCHA detected but auto-solving is disabled. Set AUTO_SOLVE_CAPTCHA=true in .env');
        }
      }

      // Submit the form with enhanced timeout handling
      const loginSuccess = await this.submitLoginForm();
      
      if (loginSuccess) {
        await this.saveCookies();
        
        // Navigate through dashboard tabs/pages after login
        await this.navigatePostLogin();
        
        console.log('✅ Login and navigation successful');
        return true;
      } else {
        throw new Error('Login form submission failed');
      }

    } catch (error) {
      console.error('❌ Login failed:', error.message);
      return false;
    }
  }

  async checkIfLoggedIn() {
    try {
      // Look for common dashboard elements
      const dashboardIndicators = [
        'a[href*="dashboard"]',
        'a[href*="logout"]',
        '.dashboard',
        '#dashboard',
        'nav',
        '.sidebar',
        'button[onclick*="logout"]'
      ];

      for (const selector of dashboardIndicators) {
        const element = await this.page.$(selector);
        if (element) {
          console.log(`✅ Found dashboard indicator: ${selector}`);
          return true;
        }
      }

      // Check URL for dashboard patterns
      const currentUrl = this.page.url();
      if (currentUrl.includes('dashboard') || currentUrl.includes('main') || currentUrl.includes('home')) {
        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  async submitLoginForm() {
    try {
      const submitButton = await this.findSubmitButton();
      
      if (!submitButton) {
        throw new Error('Could not find submit button');
      }

      console.log('🔄 Submitting login form...');
      
      // Try multiple submission strategies
      const strategies = [
        // Strategy 1: Click and wait for navigation
        async () => {
          await Promise.all([
            this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }),
            this.page.click(submitButton)
          ]);
        },
        // Strategy 2: Click with shorter timeout
        async () => {
          await this.page.click(submitButton);
          await new Promise(resolve => setTimeout(resolve, 5000));
        },
        // Strategy 3: Press Enter on form
        async () => {
          await Promise.all([
            this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }),
            this.page.keyboard.press('Enter')
          ]);
        }
      ];

      for (let i = 0; i < strategies.length; i++) {
        try {
          console.log(`🔄 Trying submission strategy ${i + 1}...`);
          await strategies[i]();
          break;
        } catch (error) {
          console.log(`⚠️ Strategy ${i + 1} failed: ${error.message}`);
          if (i === strategies.length - 1) {
            throw error;
          }
        }
      }

      // Wait for page to settle
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if we're still on login page (indicates failure)
      const currentUrl = this.page.url();
      console.log('📄 Post-submit URL:', currentUrl);

      if (currentUrl.includes('login')) {
        // Look for error messages
        const errorMessages = await this.page.$$eval(
          '[class*="error"], [class*="alert"], .text-danger, .text-red, .error-message',
          elements => elements.map(el => el.textContent.trim()).filter(text => text.length > 0)
        ).catch(() => []);

        if (errorMessages.length > 0) {
          throw new Error(`Login failed: ${errorMessages.join(', ')}`);
        } else {
          throw new Error('Login failed: Still on login page');
        }
      }

      return true;

    } catch (error) {
      console.error('❌ Form submission failed:', error.message);
      return false;
    }
  }

  async navigatePostLogin() {
    try {
      console.log('🗺️ Navigating post-login dashboard...');
      
      // Wait for dashboard to load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Take screenshot of dashboard
      await this.page.screenshot({ path: 'dashboard_main.png', fullPage: true });
      console.log('📸 Dashboard screenshot saved');

      // Look for navigation tabs/menus
      const navigationElements = await this.page.$$eval(
        'a, button, .tab, .menu-item, nav a, .nav-link', 
        elements => elements.map(el => ({
          text: el.textContent?.trim() || '',
          href: el.href || '',
          onclick: el.onclick?.toString() || el.getAttribute('onclick') || '',
          className: el.className || '',
          id: el.id || ''
        })).filter(el => el.text.length > 0 && el.text.length < 50)
      );

      console.log(`🔗 Found ${navigationElements.length} navigation elements`);
      
      // Look for specific sections that might contain data
      const dataSections = navigationElements.filter(el => {
        const text = el.text.toLowerCase();
        return text.includes('charge') || 
               text.includes('bill') || 
               text.includes('consumption') || 
               text.includes('report') || 
               text.includes('meter') || 
               text.includes('reading') || 
               text.includes('units') || 
               text.includes('energy') ||
               text.includes('status') ||
               text.includes('dg') ||
               text.includes('grid');
      });

      console.log(`🎯 Found ${dataSections.length} potential data sections:`);
      dataSections.slice(0, 10).forEach((section, index) => {
        console.log(`   ${index + 1}. "${section.text}" (${section.href})`);
      });

      // Store navigation info for later use
      this.availableNavigation = dataSections;

      return true;

    } catch (error) {
      console.error('❌ Post-login navigation failed:', error.message);
      return false;
    }
  }

  // Helper method to find username field
  async findUsernameField() {
    const selectors = [
      'input[placeholder*="username" i]',
      'input[placeholder*="user" i]',
      'input[name="username"]',
      'input[name="user"]',
      'input[name="email"]',
      'input[type="email"]',
      '#username',
      '#user',
      '#email'
    ];

    for (const selector of selectors) {
      try {
        const field = await this.page.$(selector);
        if (field) {
          console.log(`✅ Found username field: ${selector}`);
          return selector;
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    return null;
  }

  // Helper method to find password field
  async findPasswordField() {
    const selectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[name="pass"]',
      '#password',
      '#pass'
    ];

    for (const selector of selectors) {
      try {
        const field = await this.page.$(selector);
        if (field) {
          console.log(`✅ Found password field: ${selector}`);
          return selector;
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    return null;
  }

  // Helper method to find CAPTCHA field
  async findCaptchaField() {
    const selectors = [
      'input[placeholder*="captcha" i]',
      'input[placeholder*="code" i]',
      'input[placeholder*="verify" i]',
      'input[name*="captcha"]',
      'input[name*="code"]',
      'input[id*="captcha"]',
      'input[id*="code"]'
    ];

    for (const selector of selectors) {
      try {
        const field = await this.page.$(selector);
        if (field) {
          console.log(`✅ Found CAPTCHA field: ${selector}`);
          return selector;
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    return null;
  }

  // Helper method to find submit button
  async findSubmitButton() {
    const selectors = [
      '#submitBtn',
      'button[type="submit"]',
      'input[type="submit"]',
      'button[name="submit"]',
      'button.btn',
      '.btn-login',
      '#login-btn'
    ];

    // First try CSS selectors
    for (const selector of selectors) {
      try {
        const button = await this.page.$(selector);
        if (button) {
          console.log(`✅ Found submit button: ${selector}`);
          return selector;
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    // Try finding by text content using evaluate
    try {
      const buttonByText = await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        return buttons.find(btn => {
          const text = btn.textContent || btn.value || '';
          return text.toLowerCase().includes('submit') || 
                 text.toLowerCase().includes('login') || 
                 text.toLowerCase().includes('sign in');
        });
      });
      
      if (buttonByText) {
        console.log('✅ Found submit button by text content');
        return 'button'; // Return a general selector since we found it by evaluation
      }
    } catch (e) {
      console.log('⚠️ Could not find button by text:', e.message);
    }
    
    return null;
  }

  // Helper function to find login fields
  async findLoginField(keywords, type) {
    for (const keyword of keywords) {
      const selectors = [
        `input[name*="${keyword}"]`,
        `input[id*="${keyword}"]`,
        `input[placeholder*="${keyword}"]`,
        `input[type="${type}"]`
      ];

      for (const selector of selectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 1000 });
          return selector;
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  // Helper function to find login button
  async findLoginButton() {
    const buttonSelectors = [
      'input[type="submit"]',
      'button[type="submit"]',
      'button:contains("Login")',
      'button:contains("Sign In")',
      'input[value*="Login"]',
      'input[value*="Sign"]'
    ];

    for (const selector of buttonSelectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 1000 });
        return selector;
      } catch {
        continue;
      }
    }
    return null;
  }

  // Generate fingerprint for deduplication
  generateFingerprint(sourceUrl, domPath, rawValue, parsedTs = '') {
    const data = `${sourceUrl}|${domPath}|${rawValue}|${parsedTs}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // Extract DOM path for an element
  getDOMPath(element) {
    const path = [];
    let current = element;
    
    while (current && current.tagName) {
      let selector = current.tagName.toLowerCase();
      
      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break;
      }
      
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2);
        if (classes.length > 0) {
          selector += `.${classes.join('.')}`;
        }
      }
      
      path.unshift(selector);
      current = current.parentElement;
      
      if (path.length > 5) break; // Limit path length
    }
    
    return path.join(' > ');
  }

  // Classify discovered data based on context
  classifyData(contextText, rawValue, unit) {
    const text = contextText.toLowerCase();
    let bestCategory = 'unknown';
    let maxScore = 0;

    for (const [category, keywords] of Object.entries(CLASSIFICATION_RULES)) {
      let score = 0;
      
      for (const keyword of keywords) {
        if (text.includes(keyword.toLowerCase())) {
          score += 1;
        }
      }
      
      // Boost score based on unit context
      if (unit) {
        const unitLower = unit.toLowerCase();
        if (category === 'units_consumed' && ['kwh', 'units'].includes(unitLower)) score += 2;
        if (category === 'voltage' && ['v', 'kv'].includes(unitLower)) score += 2;
        if (category === 'current' && ['a', 'amp'].includes(unitLower)) score += 2;
        if (category === 'temperature' && ['°c', 'c'].includes(unitLower)) score += 2;
        if (category === 'frequency' && unitLower === 'hz') score += 2;
      }
      
      if (score > maxScore) {
        maxScore = score;
        bestCategory = category;
      }
    }
    
    const confidence = Math.min(maxScore / 3, 1.0); // Normalize to 0-1
    return { category: bestCategory, confidence };
  }

  // Determine data type
  determineDataType(rawValue, unit) {
    if (PATTERNS.currency.test(rawValue)) return 'currency';
    if (PATTERNS.percentage.test(rawValue)) return 'percentage';
    if (PATTERNS.datetime.test(rawValue)) return 'datetime';
    if (PATTERNS.status.test(rawValue)) return 'status';
    if (/^\d+$/.test(rawValue.replace(/[,\s]/g, ''))) return 'integer';
    if (/^\d+\.\d+$/.test(rawValue.replace(/[,\s]/g, ''))) return 'number';
    return 'text';
  }

  // Parse numeric value from raw text
  parseNumericValue(rawValue, dataType) {
    if (dataType === 'status' || dataType === 'text') return null;
    
    // Remove currency symbols and commas
    let cleaned = rawValue.replace(/[₹Rs,\s]/g, '');
    
    // Handle percentages
    if (dataType === 'percentage') {
      cleaned = cleaned.replace('%', '');
    }
    
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  // Extract unit from value
  extractUnit(rawValue) {
    const unitMatch = rawValue.match(/(?:\d+(?:\.\d+)?)\s*([a-zA-Z%°]+)/i);
    if (unitMatch) {
      return unitMatch[1];
    }
    
    // Check for currency symbols
    if (/₹|Rs\.?|INR/i.test(rawValue)) {
      return '₹';
    }
    
    return null;
  }

  // Parse timestamp from text
  parseTimestamp(text) {
    const dateTimePatterns = [
      /\d{1,2}[-\/]\d{1,2}[-\/]\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?/,
      /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?/,
      /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/,
      /\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM))?/i
    ];

    for (const pattern of dateTimePatterns) {
      const match = text.match(pattern);
      if (match) {
        const parsed = new Date(match[0]);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString();
        }
      }
    }
    
    return null;
  }

  // Monitor Grid and DG LED status indicators  
  async monitorLEDStatus() {
    try {
      console.log('🔍 Monitoring Grid and DG LED status...');
      
      const currentUrl = this.page.url();
      const capturedAt = new Date().toISOString();
      
      // Look for LED status indicators and consumption data
      const ledStatusData = await this.page.evaluate(() => {
        const results = [];
        const timestamp = new Date().toISOString();
        
        // Look for Grid LED status and consumption
        const gridLeds = document.querySelectorAll('img[title*="Grid" i], img[alt*="Grid" i]');
        gridLeds.forEach(led => {
          const src = led.src || led.getAttribute('src') || '';
          const title = led.title || led.alt || 'Grid';
          
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
            domPath: led.tagName + (led.id ? `#${led.id}` : '') + (led.className ? `.${led.className.split(' ')[0]}` : ''),
            ledSrc: src,
            confidence: confidence,
            title: title,
            timestamp: timestamp,
            powerSource: 'grid'
          });
          
          // Add consumption record if found
          if (consumptionData) {
            results.push({
              category: 'grid_consumption',
              value: `${consumptionData.value} ${consumptionData.unit}`,
              type: 'consumption',
              context: contextText,
              domPath: led.tagName + '_consumption',
              ledSrc: src,
              confidence: 1.0,
              title: `Grid ${consumptionData.period} Consumption`,
              timestamp: timestamp,
              powerSource: 'grid',
              numericValue: consumptionData.value,
              unit: consumptionData.unit,
              period: consumptionData.period
            });
          }
        });
        
        // Look for DG (Diesel Generator) LED status and consumption
        const dgLeds = document.querySelectorAll('img[title*="DG" i], img[alt*="DG" i], img[title*="Generator" i], img[alt*="Generator" i]');
        dgLeds.forEach(led => {
          const src = led.src || led.getAttribute('src') || '';
          const title = led.title || led.alt || 'DG';
          
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
            domPath: led.tagName + (led.id ? `#${led.id}` : '') + (led.className ? `.${led.className.split(' ')[0]}` : ''),
            ledSrc: src,
            confidence: confidence,
            title: title,
            timestamp: timestamp,
            powerSource: 'dg'
          });
          
          // Add consumption record if found
          if (consumptionData) {
            results.push({
              category: 'dg_consumption',
              value: `${consumptionData.value} ${consumptionData.unit}`,
              type: 'consumption',
              context: contextText,
              domPath: led.tagName + '_consumption',
              ledSrc: src,
              confidence: 1.0,
              title: `DG ${consumptionData.period} Consumption`,
              timestamp: timestamp,
              powerSource: 'dg',
              numericValue: consumptionData.value,
              unit: consumptionData.unit,
              period: consumptionData.period
            });
          }
        });
        
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
            regex: /Grid[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh|units?).*?(?:Daily|Today)/gi,
            source: 'grid',
            period: 'daily'
          },
          {
            regex: /(?:Daily|Today).*?(?:Consumption|Usage).*?(?:DG|Generator)[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh|units?)/gi,
            source: 'dg',
            period: 'daily'
          },
          {
            regex: /(?:DG|Generator)[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh|units?).*?(?:Daily|Today)/gi,
            source: 'dg',
            period: 'daily'
          },
          // Live/Current patterns
          {
            regex: /(?:Current|Live|Real.?time).*?(?:Consumption|Usage|Load)[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh|W|kW|units?)/gi,
            source: 'live',
            period: 'current'
          },
          // Generic patterns that might be near source indicators
          {
            regex: /(\d+(?:\.\d+)?)\s*(KWH|kwh|units?)/gi,
            source: 'unknown',
            period: 'unknown'
          }
        ];
        
        consumptionPatterns.forEach(pattern => {
          let match;
          pattern.regex.lastIndex = 0;
          
          while ((match = pattern.regex.exec(allText)) !== null) {
            const value = parseFloat(match[1]);
            const unit = match[2].toUpperCase();
            
            // Get context around the match
            const matchIndex = match.index;
            const contextStart = Math.max(0, matchIndex - 100);
            const contextEnd = Math.min(allText.length, matchIndex + match[0].length + 100);
            const context = allText.substring(contextStart, contextEnd).trim();
            
            // Skip very small values that are likely not consumption data
            if (value < 0.1) continue;
            
            const category = pattern.source === 'unknown' ? 'power_consumption' : `${pattern.source}_consumption`;
            
            results.push({
              category: category,
              value: `${value} ${unit}`,
              type: 'consumption',
              context: context,
              domPath: 'body_text_scan',
              ledSrc: '',
              confidence: pattern.source === 'unknown' ? 0.6 : 0.95,
              title: `${pattern.source.toUpperCase()} ${pattern.period} Consumption`,
              timestamp: timestamp,
              powerSource: pattern.source,
              numericValue: value,
              unit: unit,
              period: pattern.period
            });
          }
        });
        
        // Look for power switching events in logs or status text
        const switchingPatterns = [
          /Grid.*?(?:failed|offline|down|outage)/gi,
          /DG.*?(?:started|online|switched on|activated)/gi,
          /Generator.*?(?:started|online|switched on|activated)/gi,
          /Grid.*?(?:restored|online|back|available)/gi,
          /DG.*?(?:stopped|offline|switched off|deactivated)/gi,
          /Generator.*?(?:stopped|offline|switched off|deactivated)/gi,
          /Power.*?(?:outage|failure|restored)/gi
        ];
        
        switchingPatterns.forEach((pattern, index) => {
          let match;
          pattern.lastIndex = 0;
          
          while ((match = pattern.exec(allText)) !== null) {
            const matchIndex = match.index;
            const contextStart = Math.max(0, matchIndex - 150);
            const contextEnd = Math.min(allText.length, matchIndex + match[0].length + 150);
            const context = allText.substring(contextStart, contextEnd).trim();
            
            let eventType = 'power_event';
            let source = 'unknown';
            
            const matchText = match[0].toLowerCase();
            if (matchText.includes('grid')) {
              source = 'grid';
              eventType = matchText.includes('failed') || matchText.includes('offline') ? 'grid_failure' : 'grid_restore';
            } else if (matchText.includes('dg') || matchText.includes('generator')) {
              source = 'dg';
              eventType = matchText.includes('started') || matchText.includes('online') ? 'dg_start' : 'dg_stop';
            }
            
            results.push({
              category: eventType,
              value: match[0].trim(),
              type: 'event',
              context: context,
              domPath: 'body_event_scan',
              ledSrc: '',
              confidence: 0.8,
              title: `Power Switching Event`,
              timestamp: timestamp,
              powerSource: source,
              eventType: eventType
            });
          }
        });
        const allLeds = document.querySelectorAll('img[src*="led"], img[src*="status"], img[src*="indicator"]');
        allLeds.forEach(led => {
          const src = led.src || led.getAttribute('src') || '';
          const title = led.title || led.alt || '';
          
          // Skip if already processed
          if (title.toLowerCase().includes('grid') || title.toLowerCase().includes('dg')) {
            return;
          }
          
          // Check if it's near text that mentions grid or dg
          const nearbyText = [];
          let current = led.parentElement;
          let levels = 0;
          
          while (current && levels < 3) {
            const text = current.textContent || current.innerText || '';
            nearbyText.push(text);
            current = current.parentElement;
            levels++;
          }
          
          const combinedText = nearbyText.join(' ').toLowerCase();
          
          if (combinedText.includes('grid') || combinedText.includes('mains')) {
            let status = 'unknown';
            let confidence = 0.7;
            
            if (src.includes('green')) {
              status = 'available';
              confidence = 0.9;
            } else if (src.includes('red')) {
              status = 'unavailable';
              confidence = 0.9;
            }
            
            results.push({
              category: 'grid_status',
              value: status,
              type: 'status',
              context: combinedText.substring(0, 100),
              domPath: led.tagName + (led.id ? `#${led.id}` : ''),
              ledSrc: src,
              confidence: confidence,
              title: title || 'Grid Indicator'
            });
          }
          
          if (combinedText.includes('dg') || combinedText.includes('generator') || combinedText.includes('diesel')) {
            let status = 'unknown';
            let confidence = 0.7;
            
            if (src.includes('green')) {
              status = 'available';
              confidence = 0.9;
            } else if (src.includes('red')) {
              status = 'unavailable';
              confidence = 0.9;
            }
            
            results.push({
              category: 'dg_status',
              value: status,
              type: 'status',
              context: combinedText.substring(0, 100),
              domPath: led.tagName + (led.id ? `#${led.id}` : ''),
              ledSrc: src,
              confidence: confidence,
              title: title || 'DG Indicator'
            });
          }
        });
        
        // Look for mobile app API endpoints or AJAX calls that might have live data
        const scripts = document.querySelectorAll('script');
        scripts.forEach(script => {
          const scriptContent = script.textContent || script.innerText || '';
          
          // Look for API endpoints
          const apiPatterns = [
            /(?:api|API).*?(?:live|realtime|current).*?(?:consumption|usage|load)/gi,
            /(?:mobile|app).*?(?:api|endpoint)/gi,
            /(?:ajax|fetch|xhr).*?(?:consumption|usage|live)/gi,
            /\/api\/.*?(?:consumption|usage|live|realtime)/gi,
            /(?:websocket|ws).*?(?:live|realtime)/gi
          ];
          
          apiPatterns.forEach(pattern => {
            let match;
            pattern.lastIndex = 0;
            while ((match = pattern.exec(scriptContent)) !== null) {
              results.push({
                category: 'api_endpoint',
                value: match[0].trim(),
                type: 'endpoint',
                context: scriptContent.substring(Math.max(0, match.index - 50), Math.min(scriptContent.length, match.index + match[0].length + 50)),
                domPath: 'script_scan',
                ledSrc: '',
                confidence: 0.7,
                title: 'Potential Live Data API',
                timestamp: timestamp,
                powerSource: 'api'
              });
            }
          });
        });
        
        // Look for network requests in browser (if accessible)
        if (typeof window !== 'undefined' && window.performance) {
          const entries = performance.getEntriesByType('resource');
          entries.forEach(entry => {
            if (entry.name.includes('api') && 
                (entry.name.includes('live') || entry.name.includes('realtime') || entry.name.includes('consumption'))) {
              results.push({
                category: 'live_api_call',
                value: entry.name,
                type: 'network_request',
                context: `Response time: ${entry.responseEnd - entry.responseStart}ms`,
                domPath: 'performance_entries',
                ledSrc: '',
                confidence: 0.9,
                title: 'Live Data API Call',
                timestamp: timestamp,
                powerSource: 'live_api'
              });
            }
          });
        }
        
        return results;
      });
      
      console.log(`💡 Found ${ledStatusData.length} LED status indicators`);
      
      // Save LED status data to database (outside page.evaluate)
      const savedRecords = [];
      
      for (const ledData of ledStatusData) {
        try {
          const record = {
            captured_at: capturedAt,
            source_page: currentUrl,
            dom_path: ledData.domPath,
            context_text: ledData.context,
            raw_value: ledData.value,
            data_category: ledData.category,
            data_type: ledData.type,
            numeric_value: ledData.numericValue || null,
            unit: ledData.unit || null,
            parsed_ts: null,
            confidence_score: ledData.confidence,
            metadata: JSON.stringify({
              led_src: ledData.ledSrc,
              led_title: ledData.title,
              detection_method: 'led_monitoring',
              pattern_type: 'status_indicator',
              power_source: ledData.powerSource,
              timestamp: ledData.timestamp,
              period: ledData.period,
              event_type: ledData.eventType
            })
          };
          
          // Create unique fingerprint for LED status
          const fingerprintData = `${ledData.category}_${ledData.value}_${currentUrl}_${capturedAt}`;
          record.fingerprint = require('crypto').createHash('sha256').update(fingerprintData).digest('hex');
          
          const savedId = await this.saveToDatabase(record);
          savedRecords.push({...record, id: savedId});
          
          console.log(`💾 Saved ${ledData.category}: ${ledData.value} (confidence: ${(ledData.confidence * 100).toFixed(1)}%)`);
          
        } catch (error) {
          if (error.message.includes('UNIQUE constraint failed')) {
            // Duplicate record, skip silently
            continue;
          }
          console.warn(`⚠️ Failed to save LED data: ${error.message}`);
        }
      }
      
      return savedRecords;
      
    } catch (error) {
      console.error('❌ LED status monitoring failed:', error);
      return [];
    }
  }

  // Auto-discover values on the current page
  async autoDiscoverValues() {
    try {
      console.log('🔍 Auto-discovering values on page...');
      
      const currentUrl = this.page.url();
      const capturedAt = new Date().toISOString();
      
      // Execute value discovery in browser context
      const discoveredValues = await this.page.evaluate((maxElements) => {
        const patterns = {
          currency: /(₹|Rs\.?|INR)\s*-?\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?/gi,
          numberWithUnit: /(-?\d+(?:\.\d+)?)(?:\s*(kwh|kW|W|A|V|units|m3|kVA|kWhr|Hz|°C|C)?)\b/gi,
          percentage: /\d+(?:\.\d+)?\s*%/gi,
          datetime: /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|\d{2,4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM))?/gi,
          status: /\b(on|off|connected|disconnected|grid|dg|running|stopped|charging|idle|active|inactive|normal|fault|alarm)\b/gi
        };

        function getDOMPath(element) {
          const path = [];
          let current = element;
          
          while (current && current.tagName) {
            let selector = current.tagName.toLowerCase();
            
            if (current.id) {
              selector += `#${current.id}`;
              path.unshift(selector);
              break;
            }
            
            if (current.className && typeof current.className === 'string') {
              const classes = current.className.trim().split(/\s+/).slice(0, 2);
              if (classes.length > 0) {
                selector += `.${classes.join('.')}`;
              }
            }
            
            path.unshift(selector);
            current = current.parentElement;
            
            if (path.length > 5) break;
          }
          
          return path.join(' > ');
        }

        const results = [];
        const allElements = document.querySelectorAll('body *');
        let processedCount = 0;

        for (const element of allElements) {
          if (processedCount >= maxElements) break;
          
          const text = element.innerText || element.textContent || '';
          if (!text.trim() || text.length > 200) continue;
          
          processedCount++;
          
          // Check each pattern
          for (const [patternName, regex] of Object.entries(patterns)) {
            regex.lastIndex = 0; // Reset regex
            let match;
            
            while ((match = regex.exec(text)) !== null) {
              const rawValue = match[0].trim();
              if (rawValue.length < 1) continue;
              
              results.push({
                domPath: getDOMPath(element),
                contextText: text.trim().substring(0, 500),
                rawValue: rawValue,
                patternType: patternName
              });
              
              if (results.length > 200) break; // Limit results
            }
            
            if (results.length > 200) break;
          }
          
          if (results.length > 200) break;
        }
        
        return results;
      }, CONFIG.MAX_ELEMENTS_TO_SCAN);

      console.log(`📊 Discovered ${discoveredValues.length} potential values`);

      // Process and store discovered values
      let savedCount = 0;
      let duplicateCount = 0;

      for (const discovered of discoveredValues) {
        const unit = this.extractUnit(discovered.rawValue);
        const dataType = this.determineDataType(discovered.rawValue, unit);
        const numericValue = this.parseNumericValue(discovered.rawValue, dataType);
        const parsedTs = this.parseTimestamp(discovered.contextText);
        const classification = this.classifyData(discovered.contextText, discovered.rawValue, unit);
        
        const fingerprint = this.generateFingerprint(
          currentUrl,
          discovered.domPath,
          discovered.rawValue,
          parsedTs || ''
        );

        const record = {
          captured_at: capturedAt,
          source_page: currentUrl,
          dom_path: discovered.domPath,
          context_text: discovered.contextText,
          raw_value: discovered.rawValue,
          data_category: classification.category,
          data_type: dataType,
          numeric_value: numericValue,
          unit: unit,
          parsed_ts: parsedTs,
          fingerprint: fingerprint,
          confidence_score: classification.confidence,
          metadata: JSON.stringify({
            pattern_type: discovered.patternType,
            page_title: await this.page.title()
          })
        };

        try {
          await this.insertRecord(record);
          savedCount++;
        } catch (error) {
          if (error.message.includes('UNIQUE constraint failed')) {
            duplicateCount++;
          } else {
            console.error('❌ Error inserting record:', error.message);
          }
        }
      }

      console.log(`✅ Saved ${savedCount} new records, ${duplicateCount} duplicates ignored`);
      return { savedCount, duplicateCount, totalDiscovered: discoveredValues.length };

    } catch (error) {
      console.error('❌ Error during auto-discovery:', error.message);
      throw error;
    }
  }

  // Insert record into database
  insertRecord(record) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR IGNORE INTO captured_data (
          captured_at, source_page, dom_path, context_text, raw_value,
          data_category, data_type, numeric_value, unit, parsed_ts,
          fingerprint, confidence_score, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(sql, [
        record.captured_at, record.source_page, record.dom_path,
        record.context_text, record.raw_value, record.data_category,
        record.data_type, record.numeric_value, record.unit,
        record.parsed_ts, record.fingerprint, record.confidence_score,
        record.metadata
      ], function(err) {
        if (err) {
          reject(err);
        } else if (this.changes === 0) {
          reject(new Error('UNIQUE constraint failed: fingerprint'));
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  // Perform a complete scrape cycle
  async performScrape() {
    let retries = 0;
    
    while (retries < CONFIG.RETRY_ATTEMPTS) {
      try {
        console.log(`\n🕐 Starting scrape cycle... (attempt ${retries + 1}/${CONFIG.RETRY_ATTEMPTS})`);
        
        if (!this.browser) {
          await this.initializeBrowser();
        }

        await this.loadCookies();
        
        // Login (includes post-login navigation)
        const loginSuccess = await this.login();
        if (!loginSuccess) {
          throw new Error('Login failed');
        }

        // Scrape multiple sections/tabs
        const allResults = await this.scrapeMultipleSections();
        
        console.log(`✅ Scrape cycle completed successfully - found ${allResults.length} total data points`);
        return true;

      } catch (error) {
        retries++;
        console.error(`❌ Scrape attempt ${retries} failed:`, error.message);
        
        if (retries < CONFIG.RETRY_ATTEMPTS) {
          console.log(`⏳ Waiting ${CONFIG.RETRY_DELAY}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
        }
      }
    }
    
    console.error('❌ All scrape attempts failed');
    return false;
  }

  // Scrape data from multiple sections/tabs
  async scrapeMultipleSections() {
    try {
      console.log('🗂️ Starting multi-section scraping...');
      let allResults = [];

      // Start with the current page (main dashboard)
      console.log('📊 Scraping main dashboard...');
      const mainResults = await this.autoDiscoverValues();
      allResults = allResults.concat(mainResults);

      // Monitor LED status indicators for Grid and DG
      console.log('💡 Monitoring LED status indicators...');
      const ledResults = await this.monitorLEDStatus();
      allResults = allResults.concat(ledResults);

      // Navigate to specific charges page if configured
      if (CONFIG.CHARGES_PAGE) {
        console.log(`📄 Navigating to charges page: ${CONFIG.CHARGES_PAGE}`);
        await this.page.goto(CONFIG.CHARGES_PAGE, { waitUntil: 'networkidle2', timeout: 30000 });
        
        const chargesResults = await this.autoDiscoverValues();
        allResults = allResults.concat(chargesResults);
      }

      // Explore other data-rich sections discovered during login
      if (this.availableNavigation && this.availableNavigation.length > 0) {
        console.log(`🔍 Exploring ${this.availableNavigation.length} additional sections...`);
        
        // Limit to top 5 most promising sections to avoid excessive requests
        const sectionsToExplore = this.availableNavigation.slice(0, 5);
        
        for (let i = 0; i < sectionsToExplore.length; i++) {
          const section = sectionsToExplore[i];
          
          try {
            console.log(`📑 Exploring section ${i + 1}: "${section.text}"`);
            
            if (section.href && !section.href.includes('javascript:') && !section.href.includes('logout')) {
              // Navigate to the section
              await this.page.goto(section.href, { waitUntil: 'networkidle2', timeout: 20000 });
              
              // Wait for content to load
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              // Scrape this section
              const sectionResults = await this.autoDiscoverValues();
              allResults = allResults.concat(sectionResults);
              
              console.log(`✅ Section "${section.text}" yielded ${sectionResults.length} data points`);
              
            } else if (section.onclick) {
              // Handle onclick navigation
              try {
                await this.page.evaluate((onclick) => {
                  eval(onclick);
                }, section.onclick);
                
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                const sectionResults = await this.autoDiscoverValues();
                allResults = allResults.concat(sectionResults);
                
                console.log(`✅ Section "${section.text}" (onclick) yielded ${sectionResults.length} data points`);
              } catch (e) {
                console.log(`⚠️ Failed to execute onclick for "${section.text}": ${e.message}`);
              }
            }
            
            // Small delay between sections
            await new Promise(resolve => setTimeout(resolve, 1000));
            
          } catch (error) {
            console.log(`⚠️ Failed to explore section "${section.text}": ${error.message}`);
          }
        }
      }

      console.log(`🎯 Multi-section scraping complete: ${allResults.length} total data points from all sections`);
      return allResults;

    } catch (error) {
      console.error('❌ Multi-section scraping failed:', error.message);
      return [];
    }
  }

  // Start the scheduler

  // Start scheduled scraping
  startScheduler() {
    console.log(`⏰ Starting scheduler with cron pattern: ${CONFIG.CHECK_INTERVAL_CRON}`);
    
    cron.schedule(CONFIG.CHECK_INTERVAL_CRON, async () => {
      try {
        await this.performScrape();
      } catch (error) {
        console.error('❌ Scheduled scrape failed:', error.message);
      }
    });

    console.log('🚀 Scheduler started successfully');
  }

  // Cleanup resources
  async cleanup() {
    if (this.captchaSolver) {
      await this.captchaSolver.destroy();
      console.log('🛑 CAPTCHA solver destroyed');
    }
    
    if (this.browser) {
      await this.browser.close();
      console.log('🛑 Browser closed');
    }
    
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('❌ Error closing database:', err.message);
        } else {
          console.log('🛑 Database closed');
        }
      });
    }
  }
}

// Main execution
async function main() {
  const scraper = new UPPCLScraper();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await scraper.cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await scraper.cleanup();
    process.exit(0);
  });

  try {
    // Perform initial scrape
    console.log('🚀 Starting UPPCL Auto Scraper...');
    await scraper.performScrape();
    
    // Start scheduled scraping
    scraper.startScheduler();
    
    console.log('✅ UPPCL Auto Scraper is running. Press Ctrl+C to stop.');
    
    // Keep the process alive
    setInterval(() => {
      // Heartbeat - you could add health checks here
    }, 60000);
    
  } catch (error) {
    console.error('❌ Failed to start scraper:', error.message);
    await scraper.cleanup();
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = UPPCLScraper;