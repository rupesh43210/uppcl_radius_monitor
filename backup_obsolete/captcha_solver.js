const Tesseract = require('tesseract.js');
const Jimp = require('jimp');
const fs = require('fs').promises;
const path = require('path');

class CaptchaSolver {
  constructor(options = {}) {
    this.options = {
      debug: options.debug || false,
      preprocessImages: options.preprocessImages !== false,
      maxAttempts: options.maxAttempts || 3,
      confidence: options.confidence || 0.6,
      ...options
    };
    
    this.worker = null;
  }

  async initialize() {
    if (!this.worker) {
      // Create worker without logger to avoid issues
      if (this.options.debug) {
        this.worker = await Tesseract.createWorker('eng');
      } else {
        this.worker = await Tesseract.createWorker('eng');
      }
      
      // Configure for better CAPTCHA recognition
      try {
        await this.worker.setParameters({
          tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+-*/=?',
          tessedit_pageseg_mode: Tesseract.PSM.SINGLE_WORD
        });
      } catch (paramError) {
        console.log('⚠️ Could not set OCR parameters:', paramError.message);
      }
    }
  }

  async solveCaptcha(page, captchaSelector = null) {
    try {
      console.log('🔍 Looking for CAPTCHA...');
      
      // Strategy 1: Look for text-based CAPTCHA with data-answer attribute
      const textCaptcha = await page.$('#captchaText[data-answer]');
      if (textCaptcha) {
        const answer = await page.evaluate(el => el.getAttribute('data-answer'), textCaptcha);
        const question = await page.evaluate(el => el.textContent.trim(), textCaptcha);
        
        console.log(`✅ Found text-based CAPTCHA: "${question}"`);
        console.log(`🎯 Answer from data-answer: "${answer}"`);
        
        return {
          text: answer,
          confidence: 100,
          success: true,
          type: 'text-based'
        };
      }
      
      // Strategy 2: Look for math equations in various elements
      const mathElements = await page.$$eval('[id*="captcha"], [class*="captcha"], .captcha-text, #captchaText', 
        elements => elements.map(el => ({
          text: el.textContent?.trim() || '',
          dataAnswer: el.getAttribute('data-answer'),
          id: el.id,
          className: el.className
        })).filter(el => el.text.length > 0)
      );
      
      for (const element of mathElements) {
        if (element.dataAnswer) {
          console.log(`✅ Found CAPTCHA element with data-answer: "${element.text}" → "${element.dataAnswer}"`);
          return {
            text: element.dataAnswer,
            confidence: 100,
            success: true,
            type: 'data-attribute'
          };
        }
        
        // Try to solve math equation if no data-answer
        const mathResult = this.solveMathEquation(element.text);
        if (mathResult) {
          console.log(`🧮 Solved math equation: "${element.text}" → "${mathResult}"`);
          return {
            text: mathResult,
            confidence: 95,
            success: true,
            type: 'math-equation'
          };
        }
      }
      
      // Strategy 3: Look for any visible text that might be a CAPTCHA
      const allTextElements = await page.$$eval('div, span, p', elements => 
        elements.map(el => ({
          text: el.textContent?.trim() || '',
          dataAnswer: el.getAttribute('data-answer'),
          id: el.id,
          className: el.className
        })).filter(el => {
          const text = el.text;
          return text.length > 0 && text.length < 50 && (
            text.includes('=') || 
            text.includes('+') || 
            text.includes('-') || 
            text.includes('*') || 
            text.includes('/') ||
            /^[A-Z0-9]{4,6}$/.test(text) // Random string pattern
          );
        })
      );
      
      for (const element of allTextElements) {
        if (element.dataAnswer) {
          console.log(`✅ Found CAPTCHA with data-answer: "${element.text}" → "${element.dataAnswer}"`);
          return {
            text: element.dataAnswer,
            confidence: 100,
            success: true,
            type: 'found-data-attribute'
          };
        }
        
        // Try to solve if it looks like math
        const mathResult = this.solveMathEquation(element.text);
        if (mathResult) {
          console.log(`🧮 Solved math from text: "${element.text}" → "${mathResult}"`);
          return {
            text: mathResult,
            confidence: 90,
            success: true,
            type: 'parsed-math'
          };
        }
        
        // If it's a random string, return as-is
        if (/^[A-Z0-9]{4,6}$/.test(element.text)) {
          console.log(`🔤 Found random string CAPTCHA: "${element.text}"`);
          return {
            text: element.text,
            confidence: 85,
            success: true,
            type: 'random-string'
          };
        }
      }
      
      // Fallback: Look for CAPTCHA images (original strategy)
      return await this.solveCaptchaImage(page, captchaSelector);

    } catch (error) {
      console.error('❌ CAPTCHA solving failed:', error.message);
      return null;
    }
  }

  solveMathEquation(text) {
    // Clean the text and look for math patterns
    const cleaned = text.replace(/[^0-9+\-*/=?\s]/g, '').trim();
    
    // Pattern: number operator number = ?
    const mathPattern = /(\d+)\s*([+\-*/])\s*(\d+)\s*=?\s*\??\s*$/;
    const match = cleaned.match(mathPattern);
    
    if (match) {
      const num1 = parseInt(match[1]);
      const operator = match[2];
      const num2 = parseInt(match[3]);
      
      let result;
      switch (operator) {
        case '+':
          result = num1 + num2;
          break;
        case '-':
          result = num1 - num2;
          break;
        case '*':
          result = num1 * num2;
          break;
        case '/':
          result = Math.floor(num1 / num2);
          break;
        default:
          return null;
      }
      
      return result.toString();
    }
    
    return null;
  }

  async solveCaptchaImage(page, captchaSelector = null) {
    // Original image-based CAPTCHA solving logic
    try {
      await this.initialize();
      
      console.log('🔍 Looking for CAPTCHA image...');
      
      // Try multiple strategies to find CAPTCHA image
      let captchaImage = null;
      
      // Strategy 1: Use provided selector
      if (captchaSelector) {
        captchaImage = await page.$(captchaSelector);
        if (captchaImage) {
          console.log(`✅ Found CAPTCHA with provided selector: ${captchaSelector}`);
        }
      }
      
      // Strategy 2: Common CAPTCHA selectors
      if (!captchaImage) {
        const commonSelectors = [
          'img[src*="captcha"]',
          'img[alt*="captcha"]',
          'img[title*="captcha"]',
          'img[src*="verify"]',
          'img[src*="code"]',
          'img[id*="captcha"]',
          'img[class*="captcha"]',
          'canvas',
          'img[src*="random"]',
          'img[src*="security"]'
        ];
        
        for (const selector of commonSelectors) {
          captchaImage = await page.$(selector);
          if (captchaImage) {
            console.log(`✅ Found CAPTCHA with selector: ${selector}`);
            break;
          }
        }
      }
      
      // Strategy 3: Look for images near CAPTCHA input field
      if (!captchaImage) {
        console.log('🔍 Searching for images near CAPTCHA input field...');
        
        const captchaInputs = await page.$$('input[placeholder*="captcha" i], input[placeholder*="code" i], input[placeholder*="verify" i]');
        
        for (const input of captchaInputs) {
          // Look for images in the same container or nearby
          const nearbyImages = await page.evaluateHandle((inputElement) => {
            const container = inputElement.closest('div, form, table, tr, td');
            if (container) {
              return Array.from(container.querySelectorAll('img'));
            }
            return [];
          }, input);
          
          const images = await nearbyImages.jsonValue();
          if (images && images.length > 0) {
            console.log(`✅ Found ${images.length} images near CAPTCHA input`);
            // Take the first image found near the input
            captchaImage = await page.$('img');
            break;
          }
        }
      }
      
      // Strategy 4: Look for any small images that might be CAPTCHAs
      if (!captchaImage) {
        console.log('🔍 Looking for small images that might be CAPTCHAs...');
        
        const allImages = await page.$$('img');
        for (const img of allImages) {
          const dimensions = await page.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
              width: rect.width,
              height: rect.height,
              src: element.src || '',
              alt: element.alt || '',
              visible: rect.width > 0 && rect.height > 0
            };
          }, img);
          
          // Check if it's a typical CAPTCHA size and visible
          if (dimensions.visible && 
              dimensions.width > 50 && dimensions.width < 300 && 
              dimensions.height > 20 && dimensions.height < 100) {
            console.log(`🎯 Found potential CAPTCHA image: ${dimensions.width}x${dimensions.height} - ${dimensions.src}`);
            captchaImage = img;
            break;
          }
        }
      }

      if (!captchaImage) {
        console.log('❌ No CAPTCHA image found');
        return null;
      }

      // Take screenshot of the CAPTCHA
      const captchaScreenshot = await captchaImage.screenshot();
      const timestamp = Date.now();
      const originalPath = `captcha_original_${timestamp}.png`;
      
      await fs.writeFile(originalPath, captchaScreenshot);
      console.log(`📸 CAPTCHA screenshot saved: ${originalPath}`);

      // Preprocess the image for better OCR
      let processedPath = originalPath;
      if (this.options.preprocessImages) {
        processedPath = await this.preprocessCaptchaImage(originalPath, timestamp);
      }

      // OCR the CAPTCHA
      const ocrResult = await this.performOCR(processedPath);
      
      // Clean up temporary files
      if (!this.options.debug) {
        try {
          await fs.unlink(originalPath);
          if (processedPath !== originalPath) {
            await fs.unlink(processedPath);
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      return ocrResult;

    } catch (error) {
      console.error('❌ Image CAPTCHA solving failed:', error.message);
      return null;
    }
  }

  async preprocessCaptchaImage(imagePath, timestamp) {
    try {
      console.log('🛠️ Preprocessing CAPTCHA image...');
      
      const image = await Jimp.read(imagePath);
      
      // Apply multiple preprocessing techniques
      const processedImage = image
        .clone()
        .resize(image.getWidth() * 3, image.getHeight() * 3, Jimp.RESIZE_BEZIER) // Upscale
        .greyscale() // Convert to grayscale
        .contrast(0.5) // Increase contrast
        .normalize() // Normalize colors
        .threshold({ max: 128 }); // Convert to binary

      const processedPath = `captcha_processed_${timestamp}.png`;
      await processedImage.writeAsync(processedPath);
      
      console.log(`✅ Preprocessed image saved: ${processedPath}`);
      return processedPath;

    } catch (error) {
      console.error('⚠️ Image preprocessing failed:', error.message);
      return imagePath; // Return original if preprocessing fails
    }
  }

  async performOCR(imagePath) {
    try {
      console.log('🔤 Performing OCR on CAPTCHA...');
      
      const { data: { text, confidence } } = await this.worker.recognize(imagePath);
      
      // Clean the OCR result
      const cleanedText = this.cleanOCRResult(text);
      
      console.log(`📝 OCR Result: "${cleanedText}" (confidence: ${confidence.toFixed(2)}%)`);
      
      if (confidence < this.options.confidence * 100) {
        console.log(`⚠️ Low confidence OCR result: ${confidence.toFixed(2)}%`);
      }

      return {
        text: cleanedText,
        confidence: confidence,
        success: cleanedText.length > 0 && confidence >= this.options.confidence * 100
      };

    } catch (error) {
      console.error('❌ OCR failed:', error.message);
      return {
        text: '',
        confidence: 0,
        success: false
      };
    }
  }

  cleanOCRResult(text) {
    const cleaned = text
      .replace(/[^a-zA-Z0-9+\-*/=?.\s]/g, '') // Keep math symbols
      .trim()
      .toUpperCase();
    
    // Check if it's a mathematical equation
    const mathPattern = /(\d+)\s*([+\-*/])\s*(\d+)\s*[=?]?\s*$/;
    const match = cleaned.match(mathPattern);
    
    if (match) {
      const num1 = parseInt(match[1]);
      const operator = match[2];
      const num2 = parseInt(match[3]);
      
      let result;
      switch (operator) {
        case '+':
          result = num1 + num2;
          break;
        case '-':
          result = num1 - num2;
          break;
        case '*':
          result = num1 * num2;
          break;
        case '/':
          result = Math.floor(num1 / num2);
          break;
        default:
          return cleaned;
      }
      
      console.log(`🧮 Math equation detected: ${num1} ${operator} ${num2} = ${result}`);
      return result.toString();
    }
    
    return cleaned;
  }

  async solveCaptchaWithRetries(page, inputSelector, maxAttempts = null) {
    const attempts = maxAttempts || this.options.maxAttempts;
    
    for (let attempt = 1; attempt <= attempts; attempt++) {
      console.log(`🔄 CAPTCHA solving attempt ${attempt}/${attempts}`);
      
      try {
        // Add timeout wrapper for each attempt
        const result = await Promise.race([
          this.solveCaptcha(page),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('CAPTCHA solving timeout')), 30000)
          )
        ]);
        
        if (result && result.success && result.text.length >= 1) {
          console.log(`✅ CAPTCHA solved: "${result.text}"`);
          
          // Fill the CAPTCHA input field
          const captchaInput = await page.$(inputSelector);
          if (captchaInput) {
            // Clear field first
            await captchaInput.click({ clickCount: 3 });
            await captchaInput.press('Backspace');
            
            // Type the result
            await captchaInput.type(result.text, { delay: 100 });
            console.log(`✅ CAPTCHA filled in input field`);
            
            // Wait a moment for any validation
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            return result.text;
          } else {
            console.log('❌ CAPTCHA input field not found');
          }
        } else {
          console.log(`❌ CAPTCHA solving failed on attempt ${attempt}`);
          if (result) {
            console.log(`   Text: "${result.text}", Confidence: ${result.confidence.toFixed(2)}%`);
          }
        }
        
      } catch (error) {
        console.log(`❌ CAPTCHA attempt ${attempt} failed: ${error.message}`);
      }
      
      if (attempt < attempts) {
        console.log(`🔄 Waiting before next attempt...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Try to refresh CAPTCHA if there's a refresh button
        await this.refreshCaptcha(page);
      }
    }
    
    console.log('❌ All CAPTCHA solving attempts failed');
    return null;
  }

  async refreshCaptcha(page) {
    try {
      // Look for refresh buttons with various patterns
      const refreshSelectors = [
        'button[onclick*="captcha"]',
        'img[onclick*="captcha"]',
        '[title*="refresh" i]',
        '[alt*="refresh" i]',
        '[onclick*="refresh"]',
        'button:contains("Refresh")',
        'img[src*="refresh"]',
        '.captcha-refresh',
        '#captcha-refresh'
      ];
      
      for (const selector of refreshSelectors) {
        try {
          if (selector.includes(':contains')) {
            const buttons = await page.$x("//button[contains(text(), 'Refresh')] | //img[@alt='Refresh'] | //img[@title='Refresh']");
            if (buttons.length > 0) {
              console.log('🔄 Found refresh button, clicking...');
              await buttons[0].click();
              await new Promise(resolve => setTimeout(resolve, 2000));
              return true;
            }
          } else {
            const refreshButton = await page.$(selector);
            if (refreshButton) {
              console.log(`🔄 Found refresh button with selector: ${selector}`);
              await refreshButton.click();
              await new Promise(resolve => setTimeout(resolve, 2000));
              return true;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      console.log('⚠️ No refresh button found');
      return false;
      
    } catch (error) {
      console.log('⚠️ Error refreshing CAPTCHA:', error.message);
      return false;
    }
  }

  async destroy() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

module.exports = CaptchaSolver;