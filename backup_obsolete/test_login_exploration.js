#!/usr/bin/env node

const puppeteer = require('puppeteer');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const CONFIG = {
  WEBAPP_URL: process.env.WEBAPP_URL || 'https://uppclmp.myxenius.com/AppAMR',
  USERNAME: process.env.USERNAME,
  PASSWORD: process.env.PASSWORD
};

class LoginTestScraper {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    console.log('🚀 Starting Login Test...');
    
    this.browser = await puppeteer.launch({
      headless: false,  // Always visible for debugging
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 720 });
  }

  async testLoginWithoutCaptcha() {
    try {
      console.log('🔐 Testing login without CAPTCHA...');
      await this.page.goto(CONFIG.WEBAPP_URL, { waitUntil: 'networkidle2' });
      
      // Fill credentials
      await this.page.type('input[placeholder*="username" i]', CONFIG.USERNAME);
      await this.page.type('input[type="password"]', CONFIG.PASSWORD);
      
      console.log('✅ Credentials filled');
      console.log('📝 Now trying to submit without CAPTCHA...');
      
      // Try to submit
      const submitButton = await this.page.$('#submitBtn');
      await submitButton.click();
      
      // Wait and see what happens
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check the current URL and page
      const currentUrl = this.page.url();
      const pageTitle = await this.page.title();
      
      console.log('📄 After submit:', {
        url: currentUrl,
        title: pageTitle
      });
      
      if (currentUrl.includes('login')) {
        console.log('⚠️ Still on login page - checking for CAPTCHA requirement...');
        
        // Take a screenshot to see what happened
        await this.page.screenshot({ path: 'login_attempt_without_captcha.png', fullPage: true });
        console.log('📸 Screenshot saved: login_attempt_without_captcha.png');
        
        // Look for any error messages or CAPTCHA-related content
        const pageContent = await this.page.content();
        
        // Check for CAPTCHA images that might appear after submit
        const allElements = await this.page.$$eval('*', elements => 
          elements.map(el => {
            const rect = el.getBoundingClientRect();
            return {
              tag: el.tagName,
              id: el.id,
              className: el.className,
              style: el.style.cssText,
              backgroundImage: getComputedStyle(el).backgroundImage,
              width: rect.width,
              height: rect.height,
              visible: rect.width > 0 && rect.height > 0
            };
          }).filter(el => 
            el.backgroundImage.includes('url(') ||
            el.style.includes('background') ||
            (el.visible && el.width > 50 && el.width < 300 && el.height > 20 && el.height < 100)
          )
        );
        
        console.log('🔍 Elements with background images or CAPTCHA-like dimensions:');
        allElements.slice(0, 10).forEach((el, i) => {
          console.log(`   ${i + 1}.`, {
            tag: el.tag,
            id: el.id,
            className: el.className.substring(0, 50),
            backgroundImage: el.backgroundImage.substring(0, 100),
            dimensions: `${el.width}x${el.height}`
          });
        });
        
        return false;
      } else {
        console.log('🎉 SUCCESS! Login worked without CAPTCHA!');
        await this.page.screenshot({ path: 'login_success.png', fullPage: true });
        return true;
      }
      
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      return false;
    }
  }

  async testLoginWithFakeCaptcha() {
    try {
      console.log('\n🔐 Testing login with fake CAPTCHA...');
      await this.page.goto(CONFIG.WEBAPP_URL, { waitUntil: 'networkidle2' });
      
      // Fill credentials
      await this.page.type('input[placeholder*="username" i]', CONFIG.USERNAME);
      await this.page.type('input[type="password"]', CONFIG.PASSWORD);
      
      // Try to fill CAPTCHA with some common values
      const captchaField = await this.page.$('input[placeholder*="captcha" i]');
      if (captchaField) {
        const testValues = ['123', 'abc', '5', '8', '12345', 'test'];
        
        for (const value of testValues) {
          console.log(`🧪 Trying CAPTCHA value: "${value}"`);
          
          await captchaField.click({ clickCount: 3 });
          await captchaField.type(value);
          
          const submitButton = await this.page.$('#submitBtn');
          await submitButton.click();
          
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          const currentUrl = this.page.url();
          if (!currentUrl.includes('login')) {
            console.log(`🎉 SUCCESS! Login worked with CAPTCHA: "${value}"`);
            await this.page.screenshot({ path: `login_success_captcha_${value}.png`, fullPage: true });
            return true;
          } else {
            console.log(`❌ Failed with CAPTCHA: "${value}"`);
          }
        }
      }
      
      return false;
      
    } catch (error) {
      console.error('❌ Fake CAPTCHA test failed:', error.message);
      return false;
    }
  }

  async cleanup() {
    console.log('\n🔄 Keep browser open for manual inspection? (y/n)');
    
    const keepOpen = await new Promise(resolve => {
      process.stdin.once('data', (data) => {
        const input = data.toString().trim().toLowerCase();
        resolve(input === 'y' || input === 'yes');
      });
    });

    if (!keepOpen && this.browser) {
      await this.browser.close();
      console.log('🛑 Browser closed');
    } else {
      console.log('🌐 Browser kept open for manual inspection');
    }
  }
}

// Main execution
async function main() {
  const scraper = new LoginTestScraper();
  
  try {
    await scraper.initialize();
    
    // Test 1: Try login without CAPTCHA
    const successWithoutCaptcha = await scraper.testLoginWithoutCaptcha();
    
    if (!successWithoutCaptcha) {
      // Test 2: Try login with fake CAPTCHA values
      await scraper.testLoginWithFakeCaptcha();
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