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
      // Alibaba CDN patterns (sc01, sc02, sc04, etc.)
      /https?:\/\/s\.alicdn\.com\/@sc\d+\/kf\/[^"'\s]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^"'\s]*)?/gi,
      /https?:\/\/sc\d+\.alicdn\.com\/kf\/[^"'\s]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^"'\s]*)?/gi,
      // Alibaba image URL patterns (general)
      /https?:\/\/[^"'\s]*\.alicdn\.com[^"'\s]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^"'\s]*)?/gi,
      // High-res image patterns with size indicators
      /https?:\/\/[^"'\s]+_(?:960x960|800x800|1200x1200|1600x1600)[^"'\s]*\.(?:jpg|jpeg|png|webp|gif)/gi,
      // General image patterns
      /https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^"'\s]*)?/gi,
      // Base64 encoded images (less common but possible)
      /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi,
    ];

    let found = false;
    const bodyString = typeof responseBody === 'string' 
      ? responseBody 
      : JSON.stringify(responseBody);

    // Filter out UI icons and non-product images
    const excludePatterns = [
      /imgextra/i,  // UI icons
      /icon/i,      // Icons
      /flag/i,      // Country flags
      /logo/i,      // Logos
      /_20x20|_40x40|_48x48|_60x60|_80x80/i,  // Small UI images
      /tps-\d+-\d+\.(?:png|svg)/i,  // Tiny UI graphics
    ];

    imagePatterns.forEach(pattern => {
      const matches = bodyString.match(pattern);
      if (matches) {
        matches.forEach(match => {
          // Clean up the URL
          let cleanUrl = match.replace(/['"]/g, '').trim();
          
          // Skip data URIs
          if (cleanUrl.startsWith('data:')) return;
          
          // Skip UI icons and small images
          if (excludePatterns.some(exclude => exclude.test(cleanUrl))) {
            return;
          }
          
          // Prefer high-resolution versions - upgrade thumbnails
          // Skip if already high-res
          if (cleanUrl.match(/_960x960|_800x800|_1200x1200|_1600x1600/)) {
            // Already high-res, don't modify
          } else if (cleanUrl.match(/_50x50|_100x100|_80x80/)) {
            // Try to get high-res version - handle query strings
            const urlParts = cleanUrl.split('?');
            const baseUrl = urlParts[0];
            const queryString = urlParts[1] ? '?' + urlParts[1] : '';
            cleanUrl = baseUrl.replace(/_50x50|_100x100|_80x80/g, '_960x960q80') + queryString;
          } else if (cleanUrl.includes('alicdn.com') && !cleanUrl.match(/_\d+x\d+/)) {
            // For Alibaba CDN images without size, try to get high-res
            // Handle query strings properly
            const urlParts = cleanUrl.split('?');
            const baseUrl = urlParts[0];
            const queryString = urlParts[1] ? '?' + urlParts[1] : '';
            // Only modify if it ends with image extension and doesn't already have size
            if (baseUrl.match(/\.(jpg|jpeg|png|webp|gif)$/i) && !baseUrl.match(/_\d+x\d+/)) {
              cleanUrl = baseUrl.replace(/\.(jpg|jpeg|png|webp|gif)$/i, '_960x960q80.$1') + queryString;
            }
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
    if (!fileName) return 'unnamed';
    // Replace invalid filename characters but keep some safe ones like spaces, dashes, underscores
    return fileName
      .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid chars
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/_+/g, '_') // Collapse multiple underscores
      .substring(0, 200)
      .trim();
  }

  async downloadImage(url, productId, productName = null, index = 0) {
    const productDir = productId 
      ? path.join(this.downloadDir, this.sanitizeFileName(productId))
      : path.join(this.downloadDir, 'unknown');
    
    if (!fs.existsSync(productDir)) {
      fs.mkdirSync(productDir, { recursive: true });
    }

    try {
      // Validate URL
      let urlObj;
      try {
        urlObj = new URL(url);
      } catch (error) {
        throw new Error(`Invalid URL: ${url}`);
      }

      // Extract extension from pathname, handling size suffixes like _960x960q80
      let pathname = urlObj.pathname;
      // Remove size suffixes to get clean extension
      pathname = pathname.replace(/_\d+x\d+q?\d*\.(jpg|jpeg|png|webp|gif)$/i, '.$1');
      const extension = path.extname(pathname) || '.jpg';
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
        maxRedirects: 5,
        maxContentLength: 50 * 1024 * 1024, // 50MB max file size
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.alibaba.com/',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        let errorOccurred = false;
        
        writer.on('finish', () => {
          if (!errorOccurred) {
            logger.success(`Downloaded: ${fileName}`, { url, productId });
            resolve(filePath);
          }
        });
        
        writer.on('error', (err) => {
          errorOccurred = true;
          // Clean up partial file
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          reject(err);
        });
        
        response.data.on('error', (err) => {
          errorOccurred = true;
          writer.destroy();
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          reject(err);
        });
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
    const failed = [];
    const seenUrls = new Set(); // Track downloaded URLs to avoid duplicates
    
    // Remove duplicates before downloading
    const uniqueImages = Array.from(new Set(images));
    
    logger.info(`Starting download of ${uniqueImages.length} images (${images.length} total, ${images.length - uniqueImages.length} duplicates removed)`, { 
      productId, 
      productName 
    });
    
    for (let i = 0; i < uniqueImages.length; i++) {
      const imageUrl = uniqueImages[i];
      
      // Skip if we've already processed this URL
      if (seenUrls.has(imageUrl)) {
        logger.debug(`Skipping duplicate URL: ${imageUrl}`);
        continue;
      }
      seenUrls.add(imageUrl);
      
      try {
        const filePath = await this.downloadImage(imageUrl, productId, productName, i);
        downloaded.push(filePath);
        await randomDelay(500, 1000); // Rate limiting
      } catch (error) {
        failed.push({ url: imageUrl, error: error.message });
        logger.warning(`Skipped image ${i + 1}/${uniqueImages.length}`, { 
          url: imageUrl,
          error: error.message 
        });
      }
    }
    
    logger.info(`Download complete`, { 
      productId,
      successful: downloaded.length,
      failed: failed.length,
      total: uniqueImages.length,
      duplicatesSkipped: images.length - uniqueImages.length
    });
    
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

      // Intercept JSON/XHR responses and Alibaba-specific endpoints
      if (contentType.includes('application/json') || 
          contentType.includes('text/json') ||
          url.includes('/api/') ||
          url.includes('/ajax/') ||
          url.includes('getProduct') ||
          url.includes('productDetail') ||
          url.includes('/event/app/productDetail/') ||
          url.includes('/event/app/mainAction/') ||
          url.includes('mtop.alibaba') ||
          url.includes('productQuickDetail') ||
          url.includes('descIframe') ||
          url.includes('product-detail/description')) {
        
        try {
          // Clone the response to avoid reading issues
          const responseBody = await response.text();
          let jsonData;
          
          try {
            jsonData = JSON.parse(responseBody);
          } catch (parseError) {
            // Not valid JSON, try extracting as text
            this.imageExtractor.extractFromResponse(url, responseBody);
            return;
          }
          
          // Extract product ID from URL or response
          let productId = null;
          
          // Try to extract from URL first - handle Alibaba's pattern: _1601566680007.html
          const urlMatch = url.match(/product[_-]?id[=:](\d+)/i) || 
                          url.match(/_(\d+)\.html/) ||  // Alibaba pattern: _PRODUCTID.html
                          url.match(/\/(\d+)\.html/) ||  // Standard pattern: /PRODUCTID.html
                          url.match(/detailId=(\d+)/i) ||
                          url.match(/productId=(\d+)/i);
          if (urlMatch && urlMatch[1]) {
            productId = urlMatch[1];
          }
          
          // Fallback to JSON data
          if (!productId && jsonData) {
            productId = jsonData.productId || jsonData.id || jsonData.product?.id || null;
            if (productId) {
              productId = String(productId);
            }
          }

          // Extract product name
          let productName = null;
          if (jsonData && (jsonData.productName || jsonData.name || jsonData.product?.name)) {
            productName = jsonData.productName || jsonData.name || jsonData.product?.name;
          }

          const found = this.imageExtractor.extractFromJSON(jsonData, productId);
          
          if (found) {
            const count = productId ? this.imageExtractor.getProductUrls(productId).length : 0;
            logger.debug(`Found images in response`, { 
              url, 
              productId,
              productName,
              count 
            });
          }
        } catch (error) {
          // Error reading response, log but don't fail
          logger.debug(`Error processing response`, { url, error: error.message });
        }
      }

      // Also intercept direct image requests (but skip small thumbnails and UI icons)
      if (url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)) {
        // Skip obvious thumbnails and UI elements
        const skipPatterns = [
          /_50x50|_80x80|_100x100/i,
          /thumbnail/i,
          /imgextra/i,
          /icon/i,
          /flag/i,
          /logo/i,
          /tps-\d+-\d+\.(?:png|svg)/i,
        ];
        
        const shouldSkip = skipPatterns.some(pattern => pattern.test(url));
        
        if (!shouldSkip && url.includes('alicdn.com')) {
          // Upgrade to high-res if it's a thumbnail - handle query strings
          let imageUrl = url;
          
          // Skip if already high-res
          if (!url.match(/_960x960|_800x800|_1200x1200|_1600x1600/i)) {
            if (url.match(/_50x50|_80x80|_100x100/i)) {
              const urlParts = url.split('?');
              const baseUrl = urlParts[0];
              const queryString = urlParts[1] ? '?' + urlParts[1] : '';
              imageUrl = baseUrl.replace(/_50x50|_80x80|_100x100/g, '_960x960q80') + queryString;
            } else if (!url.match(/_\d+x\d+/)) {
              // No size specified, add high-res suffix - handle query strings
              const urlParts = url.split('?');
              const baseUrl = urlParts[0];
              const queryString = urlParts[1] ? '?' + urlParts[1] : '';
              if (baseUrl.match(/\.(jpg|jpeg|png|webp|gif)$/i) && !baseUrl.match(/_\d+x\d+/)) {
                imageUrl = baseUrl.replace(/\.(jpg|jpeg|png|webp|gif)$/i, '_960x960q80.$1') + queryString;
              }
            }
          }
          
          this.imageExtractor.imageUrls.add(imageUrl);
          logger.debug(`Found direct image URL`, { url: imageUrl, original: url });
        }
      }
    });

    logger.success('Network interception setup complete');
  }

  async scrapeProductPage(productUrl, retryCount = 0) {
    try {
      logger.info(`Scraping product page`, { url: productUrl, attempt: retryCount + 1 });

      // Navigate to page
      try {
        await this.page.goto(productUrl, { 
          waitUntil: 'networkidle',
          timeout: this.config.timeout 
        });
      } catch (error) {
        // If networkidle fails, try with domcontentloaded
        logger.warning('networkidle timeout, trying domcontentloaded', { url: productUrl });
        await this.page.goto(productUrl, { 
          waitUntil: 'domcontentloaded',
          timeout: this.config.timeout 
        });
      }

      await randomDelay(2000, 3000);

      // Extract product ID and name from page
      const productInfo = await this.page.evaluate(() => {
        // Try multiple patterns for product ID
        const url = window.location.href;
        let productId = null;
        
        // Alibaba pattern: _1601566680007.html
        const match1 = url.match(/_(\d+)\.html/);
        if (match1) {
          productId = match1[1];
        } else {
          // Standard pattern: /1234567890.html
          const match2 = url.match(/\/(\d+)\.html/);
          if (match2) {
            productId = match2[1];
          }
        }
        
        const productName = document.querySelector('h1')?.textContent?.trim() ||
                           document.querySelector('[data-product-name]')?.textContent?.trim() ||
                           document.querySelector('.product-title')?.textContent?.trim() ||
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

      // Wait for any remaining lazy-loaded images and network requests
      // Give time for lazy-loaded images to trigger and network requests to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Additional wait for any pending requests
      // Some pages have continuous network activity, so we just wait a bit more
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Extract images from network responses
      const productId = productInfo.productId || 'unknown';
      const productName = productInfo.productName || 'product';
      
      // Try to get product-specific URLs first, then fallback to all URLs
      let imageUrls = [];
      if (productId !== 'unknown' && this.imageExtractor.getProductUrls(productId).length > 0) {
        imageUrls = this.imageExtractor.getProductUrls(productId);
      } else {
        // Get all URLs and filter for product images
        const allUrls = Array.from(this.imageExtractor.imageUrls);
        imageUrls = allUrls.filter(url => {
          // Must be from Alibaba CDN
          if (!url.includes('alicdn.com')) return false;
          
          // Skip UI elements
          const skipPatterns = [
            /imgextra/i,
            /icon/i,
            /flag/i,
            /logo/i,
            /_20x20|_40x40|_48x48|_60x60|_80x80/i,
            /tps-\d+-\d+\.(?:png|svg)/i,
          ];
          
          if (skipPatterns.some(pattern => pattern.test(url))) return false;
          
          // Prefer high-res images (960x960, 800x800, etc.) or sc01/sc04/sc02 patterns
          // Match scXX.alicdn.com patterns or high-res size indicators
          const hasHighRes = url.match(/sc\d+\.alicdn\.com|_960x960|_800x800|_1200x1200|_1600x1600/i);
          // Or product images from kf/ folder (without double size patterns which indicate errors)
          const isKfProduct = url.includes('alicdn.com/kf/') && !url.match(/_\d+x\d+.*_\d+x\d+/);
          // Also accept images from scXX subdomains (product image servers)
          const isScSubdomain = url.match(/sc\d+\.alicdn\.com/i);
          
          return hasHighRes || isKfProduct || isScSubdomain;
        });
        
        // Remove duplicates and sort by quality (prefer larger sizes)
        const uniqueUrls = Array.from(new Set(imageUrls));
        imageUrls = uniqueUrls.sort((a, b) => {
          const aSize = a.match(/_(\d+)x\d+/)?.[1] || '0';
          const bSize = b.match(/_(\d+)x\d+/)?.[1] || '0';
          const sizeDiff = parseInt(bSize) - parseInt(aSize);
          
          // If sizes are equal, prefer URLs with 'kf/' (product images)
          if (sizeDiff === 0) {
            const aIsKf = a.includes('/kf/') ? 1 : 0;
            const bIsKf = b.includes('/kf/') ? 1 : 0;
            return bIsKf - aIsKf;
          }
          
          return sizeDiff;
        });
        
        // If no filtered URLs, use all (but still filter out obvious UI elements)
        if (imageUrls.length === 0) {
          imageUrls = allUrls.filter(url => 
            url.includes('alicdn.com') && 
            !url.match(/imgextra|icon|flag|logo|_20x20|_40x40|_48x48|_60x60|_80x80/i)
          );
        }
      }

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
    try {
      if (this.context) {
        await this.context.close().catch(() => {});
      }
      if (this.browser) {
        await this.browser.close();
        logger.info('Browser closed');
      }
    } catch (error) {
      logger.warning('Error closing browser', { error: error.message });
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
// Check if this file is being run directly (not imported as a module)
const isMainModule = () => {
  if (!process.argv[1]) return false;
  
  const urlPath = fileURLToPath(import.meta.url);
  const mainPath = process.argv[1];
  
  // Normalize paths for comparison
  const normalizedUrlPath = urlPath.replace(/\\/g, '/');
  const normalizedMainPath = mainPath.replace(/\\/g, '/');
  
  // Check if paths match (accounting for different formats)
  return normalizedUrlPath === normalizedMainPath || 
         normalizedMainPath.endsWith('scraper.js') ||
         normalizedMainPath.endsWith('/scraper.js');
};

// Run main function if this is the main module
if (isMainModule()) {
  main().catch((error) => {
    console.error('Fatal error in main execution:', error);
    process.exit(1);
  });
}

export { AlibabaImageScraper, ImageUrlExtractor, ImageDownloader };

