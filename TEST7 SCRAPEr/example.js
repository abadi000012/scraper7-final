/**
 * Example usage of the Alibaba Image Scraper
 * 
 * This demonstrates how to use the scraper programmatically
 */

import { AlibabaImageScraper } from './scraper.js';

async function example() {
  const scraper = new AlibabaImageScraper({
    headless: false, // Set to true for headless mode
    timeout: 60000,
    retryAttempts: 3,
    // Proxy configuration (optional)
    // proxy: 'http://proxy.example.com:8080',
    // proxyUsername: 'your_username',
    // proxyPassword: 'your_password',
  });

  try {
    // Initialize the browser
    await scraper.initialize();

    // Scrape a single product
    const productUrl = 'https://www.alibaba.com/product-detail/YOUR_PRODUCT_ID.html';
    const result = await scraper.scrapeProductPage(productUrl);
    
    console.log('Scraping result:', result);
    console.log(`Downloaded ${result.images?.length || 0} images`);

    // Or scrape multiple products
    const productUrls = [
      'https://www.alibaba.com/product-detail/1234567890.html',
      'https://www.alibaba.com/product-detail/0987654321.html',
    ];
    
    const results = await scraper.scrapeMultipleProducts(productUrls);
    console.log(`Scraped ${results.length} products`);
    console.log(`Successfully downloaded images from ${results.filter(r => r.success).length} products`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Always close the browser
    await scraper.close();
  }
}

// Uncomment to run the example
// example().catch(console.error);

