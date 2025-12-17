import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const config = {
  headless: false, // Set to true for Replit/VPS if needed
  timeout: 60000,
  retryAttempts: 3,
  retryDelay: 5000,
  scrollDelay: 2000,
  minHumanDelay: 500,
  maxHumanDelay: 2000,
  downloadDir: path.join(__dirname, 'downloads'),
  logFile: path.join(__dirname, 'scraper.log'),
  // Proxy configuration (set these in config.json or environment variables)
  proxy: process.env.PROXY_URL || null,
  proxyUsername: process.env.PROXY_USERNAME || null,
  proxyPassword: process.env.PROXY_PASSWORD || null,
};

// Logger utility
class Logger {
  constructor(logFile) {
    this.logFile = logFile;
    this.ensureLogFile();
  }

  ensureLogFile() {
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, '');
    }
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
    
    // Console output with colors
    const colors = {
      INFO: chalk.blue,
      SUCCESS: chalk.green,
      WARNING: chalk.yellow,
      ERROR: chalk.red,
      DEBUG: chalk.gray,
    };
    
    console.log(colors[level] || chalk.white(`[${level}] ${message}`));
    if (data) console.log(chalk.gray(JSON.stringify(data, null, 2)));
    
    // File output
    fs.appendFileSync(this.logFile, logMessage);
  }

  info(message, data) { this.log('INFO', message, data); }
  success(message, data) { this.log('SUCCESS', message, data); }
  warning(message, data) { this.log('WARNING', message, data); }
  error(message, data) { this.log('ERROR', message, data); }
  debug(message, data) { this.log('DEBUG', message, data); }
}

const logger = new Logger(config.logFile);

// Utility functions
function randomDelay(min = config.minHumanDelay, max = config.maxHumanDelay) {
  return new Promise(resolve => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    setTimeout(resolve, delay);
  });
}

function randomMouseMovement() {
  return {
    x: Math.floor(Math.random() * 200) - 100,
    y: Math.floor(Math.random() * 200) - 100,
  };
}

// Image URL extractor from network responses
class ImageUrlExtractor {
  constructor() {
    this.imageUrls = new Set();
    this.productImages = new Map(); // productId -> Set of image URLs
  }

  extractFromResponse(url, responseBody, productId = null) {
    const imagePatterns = [
      // Alibaba image URL patterns
      /https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^"'\s]*)?/gi,
      // Base64 encoded images (less common but possible)
      /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi,
      // Alibaba CDN patterns
      /https?:\/\/[^"'\s]*\.alicdn\.com[^"'\s]+\.(?:jpg|jpeg|png|webp|gif)/gi,
      // High-res image patterns
      /https?:\/\/[^"'\s]+_(\d+x\d+|[^"'\s]*high[^"'\s]*)\.(?:jpg|jpeg|png|webp|gif)/gi,
    ];

    let found = false;
    const bodyString = typeof responseBody === 'string' 
      ? responseBody 
      : JSON.stringify(responseBody);

    imagePatterns.forEach(pattern => {
      const matches = bodyString.match(pattern);
      if (matches) {
        matches.forEach(match => {
          // Clean up the URL
          let cleanUrl = match.replace(/['"]/g, '').trim();
          
          // Skip data URIs for now (can be added if needed)
          if (cleanUrl.startsWith('data:')) return;
          
          // Prefer high-resolution versions
          if (cleanUrl.includes('_50x50') || cleanUrl.includes('_100x100')) {
            cleanUrl = cleanUrl.replace(/_50x50|_100x100/g, '_800x800');
          }
          
          this.imageUrls.add(cleanUrl);
          
          if (productId) {
            if (!this.productImages.has(productId)) {
              this.productImages.set(productId, new Set());
            }
            this.productImages.get(productId).add(cleanUrl);
          }
          
          found = true;
        });
      }
    });

    return found;
  }

  extractFromJSON(jsonData, productId = null) {
    if (!jsonData) return false;
    
    const jsonString = typeof jsonData === 'string' 
      ? jsonData 
      : JSON.stringify(jsonData);
    
    return this.extractFromResponse(null, jsonString, productId);
  }

  getAllUrls() {
    return Array.from(this.imageUrls);
  }

  getProductUrls(productId) {
    return this.productImages.has(productId) 
      ? Array.from(this.productImages.get(productId))
      : [];
  }

  clear() {
    this.imageUrls.clear();
    this.productImages.clear();
  }
}

// Human-like behavior simulator
class HumanBehavior {
  constructor(page) {
    this.page = page;
  }

  async randomScroll() {
    const scrollAmount = Math.floor(Math.random() * 500) + 200;
    await this.page.evaluate((amount) => {
      window.scrollBy(0, amount);
    }, scrollAmount);
    await randomDelay(500, 1500);
  }

  async smoothScroll() {
    await this.page.evaluate(() => {
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
      });
    });
    await randomDelay(1000, 2000);
  }

  async randomMouseMove() {
    const movement = randomMouseMovement();
    await this.page.mouse.move(
      Math.max(100, Math.min(800, 400 + movement.x)),
      Math.max(100, Math.min(600, 300 + movement.y))
    );
    await randomDelay(200, 500);
  }

  async hoverElement(selector) {
    try {
      const element = await this.page.$(selector);
      if (element) {
        await element.hover();
        await randomDelay(300, 800);
        return true;
      }
    } catch (error) {
      logger.debug(`Could not hover element: ${selector}`, { error: error.message });
    }
    return false;
  }

  async simulateReading() {
    await randomDelay(1000, 3000);
    await this.randomMouseMove();
  }
}

// Image downloader
class ImageDownloader {
  constructor(downloadDir) {
    this.downloadDir = downloadDir;
    this.ensureDownloadDir();
  }

  ensureDownloadDir() {
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  sanitizeFileName(fileName) {
    return fileName.replace(/[^a-z0-9]/gi, '_').substring(0, 200);
  }

  async downloadImage(url, productId, productName = null, index = 0) {
    const productDir = productId 
      ? path.join(this.downloadDir, this.sanitizeFileName(productId))
      : path.join(this.downloadDir, 'unknown');
    
    if (!fs.existsSync(productDir)) {
      fs.mkdirSync(productDir, { recursive: true });
    }

    try {
      const urlObj = new URL(url);
      const extension = path.extname(urlObj.pathname) || '.jpg';
      const fileName = productName 
        ? `${this.sanitizeFileName(productName)}_${index}${extension}`
        : `image_${index}${extension}`;
      
      const filePath = path.join(productDir, fileName);

      // Skip if already exists
      if (fs.existsSync(filePath)) {
        logger.debug(`Image already exists: ${filePath}`);
        return filePath;
      }

      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.alibaba.com/',
        },
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          logger.success(`Downloaded: ${fileName}`, { url, productId });
          resolve(filePath);
        });
        writer.on('error', reject);
      });
    } catch (error) {
      logger.error(`Failed to download image: ${url}`, { 
        error: error.message,
        productId 
      });
      throw error;
    }
  }

  async downloadAll(images, productId = null, productName = null) {
    const downloaded = [];
    for (let i = 0; i < images.length; i++) {
      try {
        const filePath = await this.downloadImage(images[i], productId, productName, i);
        downloaded.push(filePath);
        await randomDelay(500, 1000); // Rate limiting
      } catch (error) {
        logger.warning(`Skipped image ${i + 1}/${images.length}`, { 
          url: images[i],
          error: error.message 
        });
      }
    }
    return downloaded;
  }
}

// Main scraper class
class AlibabaImageScraper {
  constructor(options = {}) {
    this.config = { ...config, ...options };
    this.browser = null;
    this.context = null;
    this.page = null;
    this.imageExtractor = new ImageUrlExtractor();
    this.downloader = new ImageDownloader(this.config.downloadDir);
    this.humanBehavior = null;
  }

  async initialize() {
    logger.info('Initializing browser...');
    
    const launchOptions = {
      headless: this.config.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    };

    // Add proxy if configured
    if (this.config.proxy) {
      launchOptions.proxy = {
        server: this.config.proxy,
        username: this.config.proxyUsername,
        password: this.config.proxyPassword,
      };
      logger.info('Using proxy', { server: this.config.proxy });
    }

    this.browser = await chromium.launch(launchOptions);

    const contextOptions = {
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
    };

    this.context = await this.browser.newContext(contextOptions);
    
    // Stealth mode - hide automation
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      
      // Override plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    });

    this.page = await this.context.newPage();
    this.humanBehavior = new HumanBehavior(this.page);

    // Setup network interception
    await this.setupNetworkInterception();

    logger.success('Browser initialized');
  }

  async setupNetworkInterception() {
    logger.info('Setting up network interception...');

    this.page.on('response', async (response) => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';

      // Intercept JSON/XHR responses
      if (contentType.includes('application/json') || 
          contentType.includes('text/json') ||
          url.includes('/api/') ||
          url.includes('/ajax/') ||
          url.includes('getProduct') ||
          url.includes('productDetail')) {
        
        try {
          const responseBody = await response.text();
          const jsonData = JSON.parse(responseBody);
          
          // Extract product ID from URL or response
          let productId = null;
          const productIdMatch = url.match(/product[_-]?id[=:](\d+)/i) || 
                                url.match(/\/(\d+)\.html/) ||
                                (jsonData.productId || jsonData.id || jsonData.product?.id);
          
          if (productIdMatch) {
            productId = typeof productIdMatch === 'string' || typeof productIdMatch === 'number'
              ? productIdMatch
              : productIdMatch[1] || productIdMatch;
          }

          // Extract product name
          let productName = null;
          if (jsonData.productName || jsonData.name || jsonData.product?.name) {
            productName = jsonData.productName || jsonData.name || jsonData.product?.name;
          }

          const found = this.imageExtractor.extractFromJSON(jsonData, productId);
          
          if (found) {
            logger.debug(`Found images in response`, { 
              url, 
              productId,
              productName,
              count: this.imageExtractor.getProductUrls(productId).length 
            });
          }
        } catch (error) {
          // Not JSON or parsing failed, try as text
          try {
            const responseBody = await response.text();
            this.imageExtractor.extractFromResponse(url, responseBody);
          } catch (e) {
            // Ignore errors
          }
        }
      }

      // Also intercept direct image requests
      if (url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)) {
        this.imageExtractor.imageUrls.add(url);
        logger.debug(`Found direct image URL`, { url });
      }
    });

    logger.success('Network interception setup complete');
  }

  async scrapeProductPage(productUrl, retryCount = 0) {
    try {
      logger.info(`Scraping product page`, { url: productUrl, attempt: retryCount + 1 });

      // Navigate to page
      await this.page.goto(productUrl, { 
        waitUntil: 'networkidle',
        timeout: this.config.timeout 
      });

      await randomDelay(2000, 3000);

      // Extract product ID and name from page
      const productInfo = await this.page.evaluate(() => {
        const productIdMatch = window.location.href.match(/\/(\d+)\.html/);
        const productId = productIdMatch ? productIdMatch[1] : null;
        
        const productName = document.querySelector('h1')?.textContent?.trim() ||
                           document.querySelector('[data-product-name]')?.textContent?.trim() ||
                           document.title;
        
        return { productId, productName };
      });

      logger.info('Product info extracted', productInfo);

      // Simulate human behavior
      await this.humanBehavior.randomMouseMove();
      await this.humanBehavior.simulateReading();

      // Scroll to trigger lazy loading
      let previousHeight = 0;
      let currentHeight = await this.page.evaluate(() => document.body.scrollHeight);
      
      while (currentHeight > previousHeight) {
        previousHeight = currentHeight;
        await this.humanBehavior.smoothScroll();
        await this.humanBehavior.randomScroll();
        await randomDelay(1000, 2000);
        
        currentHeight = await this.page.evaluate(() => document.body.scrollHeight);
        
        // Try hovering over image galleries
        const imageSelectors = [
          '.product-image',
          '.image-gallery img',
          '[data-image]',
          '.main-image',
        ];
        
        for (const selector of imageSelectors) {
          await this.humanBehavior.hoverElement(selector);
        }
      }

      // Wait for any remaining lazy-loaded images
      await this.page.waitForTimeout(3000);

      // Extract images from network responses
      const productId = productInfo.productId || 'unknown';
      const productName = productInfo.productName || 'product';
      const imageUrls = this.imageExtractor.getProductUrls(productId).length > 0
        ? this.imageExtractor.getProductUrls(productId)
        : Array.from(this.imageExtractor.imageUrls);

      if (imageUrls.length === 0) {
        logger.warning('No images found in network responses', { url: productUrl });
        return { success: false, images: [] };
      }

      logger.success(`Found ${imageUrls.length} images`, { productId, productName });

      // Download images
      const downloaded = await this.downloader.downloadAll(
        imageUrls,
        productId,
        productName
      );

      logger.success(`Downloaded ${downloaded.length} images`, { 
        productId,
        productName,
        total: imageUrls.length 
      });

      return {
        success: true,
        productId,
        productName,
        images: downloaded,
        totalFound: imageUrls.length,
      };

    } catch (error) {
      logger.error('Error scraping product page', { 
        url: productUrl,
        error: error.message,
        stack: error.stack 
      });

      if (retryCount < this.config.retryAttempts) {
        logger.info(`Retrying... (${retryCount + 1}/${this.config.retryAttempts})`);
        await randomDelay(this.config.retryDelay, this.config.retryDelay * 2);
        return this.scrapeProductPage(productUrl, retryCount + 1);
      }

      throw error;
    }
  }

  async scrapeMultipleProducts(productUrls) {
    const results = [];
    
    for (const url of productUrls) {
      try {
        const result = await this.scrapeProductPage(url);
        results.push(result);
        
        // Clear extracted URLs for next product
        this.imageExtractor.clear();
        
        // Delay between products
        await randomDelay(3000, 5000);
      } catch (error) {
        logger.error('Failed to scrape product', { url, error: error.message });
        results.push({ success: false, url, error: error.message });
      }
    }

    return results;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      logger.info('Browser closed');
    }
  }
}

// Main execution
async function main() {
  const scraper = new AlibabaImageScraper();

  try {
    await scraper.initialize();

    // Example: Scrape a product page
    // Replace with actual Alibaba product URLs
    const productUrls = [
      // Add your Alibaba product URLs here
      // Example: 'https://www.alibaba.com/product-detail/1234567890.html'
    ];

    if (productUrls.length === 0) {
      logger.warning('No product URLs provided. Please add URLs to the productUrls array.');
      logger.info('Example usage:');
      logger.info('  const productUrls = ["https://www.alibaba.com/product-detail/1234567890.html"];');
      
      // Interactive mode: prompt for URL
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const url = await new Promise(resolve => {
        rl.question('Enter Alibaba product URL: ', resolve);
      });
      rl.close();

      if (url) {
        const result = await scraper.scrapeProductPage(url);
        logger.info('Scraping complete', result);
      }
    } else {
      const results = await scraper.scrapeMultipleProducts(productUrls);
      logger.info('All scraping complete', { 
        total: results.length,
        successful: results.filter(r => r.success).length 
      });
    }

  } catch (error) {
    logger.error('Fatal error', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    await scraper.close();
  }
}

// Run if executed directly
// Standard ES module pattern: check if this file is being run directly
const runAsMain = async () => {
  try {
    // Check if we're the main module
    const urlPath = fileURLToPath(import.meta.url);
    const mainPath = process.argv[1];
    
    if (urlPath === mainPath || mainPath?.endsWith('scraper.js')) {
      await main();
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

runAsMain();

export { AlibabaImageScraper, ImageUrlExtractor, ImageDownloader };

