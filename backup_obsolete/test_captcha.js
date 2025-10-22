#!/usr/bin/env node

const puppeteer = require('puppeteer');
const dotenv = require('dotenv');
const CaptchaSolver = require('./captcha_solver');

// Load environment variables
dotenv.config();

const CONFIG = {
  WEBAPP_URL: process.env.WEBAPP_URL || 'https://uppclmp.myxenius.com/AppAMR',
  USERNAME: process.env.USERNAME,
  PASSWORD: process.env.PASSWORD,
  HEADLESS: process.env.HEADLESS !== 'false'
};

class CaptchaTestScraper {
  constructor() {
    this.browser = null;
    this.page = null;
    this.captchaSolver = null;
  }

  async initialize() {
    console.log('🚀 Starting CAPTCHA Test Scraper...');
    console.log('🔧 Config:', {
      url: CONFIG.WEBAPP_URL,
      username: CONFIG.USERNAME ? '✓' : '❌',
      password: CONFIG.PASSWORD ? '✓' : '❌',
      headless: CONFIG.HEADLESS
    });

    // Initialize CAPTCHA solver
    this.captchaSolver = new CaptchaSolver({
      debug: true,
      maxAttempts: 3,
      confidence: 0.6
    });

    this.browser = await puppeteer.launch({
      headless: CONFIG.HEADLESS,
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

  async testCaptchaSolving() {
    try {
      console.log('🔐 Testing CAPTCHA solving...');
      await this.page.goto(CONFIG.WEBAPP_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      
      console.log('📄 Current page:', this.page.url());
      console.log('📝 Page title:', await this.page.title());

      // Take initial screenshot
      await this.page.screenshot({ path: 'captcha_test_page.png', fullPage: true });
      console.log('📸 Page screenshot saved: captcha_test_page.png');

      // Find and fill username and password
      const usernameField = await this.page.$('input[placeholder*="username" i]');
      const passwordField = await this.page.$('input[type="password"]');
      const captchaField = await this.page.$('input[placeholder*="captcha" i]');

      if (!usernameField || !passwordField) {
        throw new Error('Could not find login fields');
      }

      console.log('✏️ Filling username and password...');
      await usernameField.type(CONFIG.USERNAME);
      await passwordField.type(CONFIG.PASSWORD);

      // Wait a moment for any dynamic content to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if CAPTCHA appeared after filling credentials
      console.log('🔍 Checking for CAPTCHA after filling credentials...');
      
      // Take another screenshot to see if anything changed
      await this.page.screenshot({ path: 'captcha_test_after_credentials.png', fullPage: true });
      
      // Look for any new images or canvas elements
      const allElements = await this.page.$$eval('img, canvas', elements => 
        elements.map(el => ({
          tag: el.tagName,
          src: el.src || '',
          width: el.width || el.offsetWidth,
          height: el.height || el.offsetHeight,
          id: el.id,
          className: el.className,
          style: el.style.cssText || ''
        }))
      );
      
      console.log('🔍 All images and canvas elements:', JSON.stringify(allElements, null, 2));

      if (captchaField) {
        console.log('🎯 CAPTCHA field found! Testing auto-solving...');
        
        // Check if there's any JavaScript that might generate the CAPTCHA
        const scriptTags = await this.page.$$eval('script', scripts => 
          scripts.map(script => script.src || script.textContent.substring(0, 200))
        );
        
        console.log('📜 Script tags (first 200 chars):', scriptTags);
        
        // Try clicking on the CAPTCHA field to see if it triggers image generation
        console.log('🖱️ Clicking CAPTCHA field to trigger image generation...');
        await captchaField.click();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check again for images
        const imagesAfterClick = await this.page.$$eval('img, canvas', elements => 
          elements.map(el => ({
            tag: el.tagName,
            src: el.src || '',
            width: el.width || el.offsetWidth,
            height: el.height || el.offsetHeight,
            id: el.id,
            className: el.className
          }))
        );
        
        console.log('🔍 Images after clicking CAPTCHA field:', JSON.stringify(imagesAfterClick, null, 2));
        
        // Look for refresh buttons or CAPTCHA generation buttons
        const possibleCaptchaButtons = await this.page.$$eval('button, img[onclick], div[onclick]', elements => 
          elements.map(el => ({
            tag: el.tagName,
            onclick: el.onclick?.toString() || el.getAttribute('onclick') || '',
            text: el.textContent?.trim() || '',
            title: el.title || '',
            alt: el.alt || '',
            id: el.id,
            className: el.className
          })).filter(el => 
            el.onclick.includes('captcha') || 
            el.text.toLowerCase().includes('refresh') ||
            el.text.toLowerCase().includes('reload') ||
            el.title.toLowerCase().includes('captcha') ||
            el.alt.toLowerCase().includes('captcha')
          )
        );
        
        console.log('🔄 Possible CAPTCHA control buttons:', JSON.stringify(possibleCaptchaButtons, null, 2));
        
        // Try to find and click a CAPTCHA refresh button
        if (possibleCaptchaButtons.length > 0) {
          console.log('🔄 Trying to click CAPTCHA refresh button...');
          const refreshButton = await this.page.$(`#${possibleCaptchaButtons[0].id}`) || 
                                 await this.page.$(`.${possibleCaptchaButtons[0].className.split(' ')[0]}`);
          
          if (refreshButton) {
            await refreshButton.click();
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Check for images again
            const imagesAfterRefresh = await this.page.$$eval('img, canvas', elements => 
              elements.map(el => ({
                tag: el.tagName,
                src: el.src || '',
                width: el.width || el.offsetWidth,
                height: el.height || el.offsetHeight,
                id: el.id,
                className: el.className
              }))
            );
            
            console.log('🔍 Images after refresh:', JSON.stringify(imagesAfterRefresh, null, 2));
          }
        }
        
        // Test CAPTCHA solving multiple times
        for (let attempt = 1; attempt <= 3; attempt++) {
          console.log(`\n🔄 CAPTCHA solving attempt ${attempt}/3:`);
          
          const result = await this.captchaSolver.solveCaptcha(this.page);
          
          if (result && result.success) {
            console.log(`✅ CAPTCHA solved successfully: "${result.text}" (confidence: ${result.confidence.toFixed(2)}%)`);
            
            // Fill the CAPTCHA field
            await captchaField.click({ clickCount: 3 }); // Select all
            await captchaField.type(result.text);
            
            console.log('✅ CAPTCHA filled in form');
            
            // Test the login
            const submitButton = await this.page.$('#submitBtn');
            if (submitButton) {
              console.log('🔄 Testing login with solved CAPTCHA...');
              
              await submitButton.click();
              await new Promise(resolve => setTimeout(resolve, 3000));
              
              const currentUrl = this.page.url();
              console.log('📄 Post-submit URL:', currentUrl);
              
              if (!currentUrl.includes('login')) {
                console.log('🎉 LOGIN SUCCESS! CAPTCHA solving worked!');
                await this.page.screenshot({ path: 'captcha_test_success.png', fullPage: true });
                return true;
              } else {
                console.log('⚠️ Still on login page, checking for errors...');
                
                // Look for error messages
                const errorMessages = await this.page.$$eval(
                  '[class*="error"], [class*="alert"], .text-danger, .text-red',
                  elements => elements.map(el => el.textContent.trim()).filter(text => text.length > 0)
                ).catch(() => []);

                if (errorMessages.length > 0) {
                  console.log('❌ Error messages:', errorMessages);
                } else {
                  console.log('🔄 No error messages, might be CAPTCHA incorrect');
                }
                
                // Refresh CAPTCHA for next attempt
                const refreshButton = await this.page.$('img[onclick*="captcha"], button[onclick*="captcha"]');
                if (refreshButton) {
                  console.log('🔄 Refreshing CAPTCHA for next attempt...');
                  await refreshButton.click();
                  await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                  console.log('⚠️ No CAPTCHA refresh button found');
                }
              }
            }
          } else {
            console.log(`❌ CAPTCHA solving failed on attempt ${attempt}`);
            if (result) {
              console.log(`   Text: "${result.text}", Confidence: ${result.confidence.toFixed(2)}%`);
            }
          }
        }
        
        console.log('❌ All CAPTCHA solving attempts failed');
        return false;
        
      } else {
        console.log('❌ No CAPTCHA field found on the page');
        
        // Show all input fields for debugging
        const allInputs = await this.page.$$eval('input', inputs => 
          inputs.map(input => ({
            name: input.name,
            type: input.type,
            placeholder: input.placeholder,
            id: input.id,
            className: input.className
          }))
        );
        
        console.log('📋 All input fields found:', JSON.stringify(allInputs, null, 2));
        return false;
      }

    } catch (error) {
      console.error('❌ CAPTCHA test failed:', error.message);
      return false;
    }
  }

  async cleanup() {
    if (this.captchaSolver) {
      await this.captchaSolver.destroy();
      console.log('🛑 CAPTCHA solver destroyed');
    }
    
    if (this.browser) {
      await this.browser.close();
      console.log('🛑 Browser closed');
    }
  }
}

// Main execution
async function main() {
  const scraper = new CaptchaTestScraper();
  
  try {
    await scraper.initialize();
    const success = await scraper.testCaptchaSolving();
    
    if (success) {
      console.log('\n🎉 CAPTCHA AUTO-SOLVING TEST PASSED!');
      console.log('✅ The scraper can automatically solve CAPTCHAs and log in');
    } else {
      console.log('\n❌ CAPTCHA AUTO-SOLVING TEST FAILED');
      console.log('🔧 You may need to:');
      console.log('   1. Check if the CAPTCHA images are clear enough for OCR');
      console.log('   2. Adjust OCR confidence levels');
      console.log('   3. Improve image preprocessing');
      console.log('   4. Verify credentials are correct');
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