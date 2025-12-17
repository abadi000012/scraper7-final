# Alibaba Product Image Scraper

A high-performance Alibaba product image scraper using Playwright with real browser emulation, network interception, and residential proxy support.

## Features

✅ **Real Browser Emulation** - Uses Playwright with Chromium in non-headless mode  
✅ **JavaScript Rendering** - Handles all JS-rendered content and lazy-loaded images  
✅ **Network Interception** - Captures high-resolution image URLs from JSON/XHR responses  
✅ **Residential Proxy Support** - Supports rotating proxies with authentication  
✅ **Human-like Behavior** - Scrolling, random delays, mouse movements, and hover actions  
✅ **Retry Logic** - Automatic retries for failed requests or blocked pages  
✅ **Organized Downloads** - Images organized by product name/ID  
✅ **Network-First Approach** - Extracts images from network/XHR, not HTML img tags  
✅ **Detailed Logging** - Comprehensive logging for debugging and monitoring  
✅ **Cross-Platform** - Works on Replit (with limitations) and VPS environments  

## Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Install Playwright browsers:**
```bash
npm run install-browsers
```

Or:
```bash
npx playwright install chromium
```

## Configuration

### Environment Variables (Recommended)

Create a `.env` file or set environment variables:

```bash
PROXY_URL=http://proxy.example.com:8080
PROXY_USERNAME=your_username
PROXY_PASSWORD=your_password
```

### Config File

Edit `config.json` to customize settings:

```json
{
  "headless": false,
  "timeout": 60000,
  "retryAttempts": 3,
  "proxy": {
    "server": "http://proxy.example.com:8080",
    "username": "your_username",
    "password": "your_password"
  }
}
```

## Usage

### Basic Usage

Edit `scraper.js` and add product URLs to the `productUrls` array:

```javascript
const productUrls = [
  'https://www.alibaba.com/product-detail/1234567890.html',
  'https://www.alibaba.com/product-detail/0987654321.html',
];
```

Then run:
```bash
npm start
```

### Programmatic Usage

```javascript
import { AlibabaImageScraper } from './scraper.js';

const scraper = new AlibabaImageScraper({
  headless: false,
  proxy: 'http://proxy.example.com:8080',
  proxyUsername: 'user',
  proxyPassword: 'pass',
});

await scraper.initialize();
const result = await scraper.scrapeProductPage('https://www.alibaba.com/product-detail/1234567890.html');
await scraper.close();
```

### Interactive Mode

If no URLs are provided, the scraper will prompt for a URL:

```bash
npm start
# Enter Alibaba product URL: https://www.alibaba.com/product-detail/1234567890.html
```

## Proxy Configuration

### Residential Proxy Providers

The scraper supports various proxy formats:

**HTTP/HTTPS Proxy:**
```javascript
proxy: 'http://username:password@proxy.example.com:8080'
```

**Separate Credentials:**
```javascript
proxy: 'http://proxy.example.com:8080'
proxyUsername: 'username'
proxyPassword: 'password'
```

### Supported Proxy Providers

- Bright Data (formerly Luminati)
- Smartproxy
- Oxylabs
- IPRoyal
- Any HTTP/HTTPS proxy with authentication

## How It Works

1. **Browser Initialization**: Launches Chromium with stealth mode to avoid detection
2. **Network Interception**: Monitors all network requests and responses
3. **Image Extraction**: Extracts image URLs from JSON/XHR responses (not HTML)
4. **Human Simulation**: Performs realistic scrolling, mouse movements, and delays
5. **Lazy Loading**: Triggers lazy-loaded images by scrolling and hovering
6. **Image Download**: Downloads high-resolution images organized by product
7. **Retry Logic**: Automatically retries failed requests

## Output Structure

Images are organized in the `downloads/` directory:

```
downloads/
├── 1234567890/
│   ├── Product_Name_0.jpg
│   ├── Product_Name_1.jpg
│   └── Product_Name_2.jpg
└── 0987654321/
    ├── Another_Product_0.jpg
    └── Another_Product_1.jpg
```

## Logging

All activities are logged to:
- **Console**: Colored output for real-time monitoring
- **scraper.log**: Detailed file logging with timestamps

Log levels:
- `INFO`: General information
- `SUCCESS`: Successful operations
- `WARNING`: Non-critical issues
- `ERROR`: Errors and failures
- `DEBUG`: Detailed debugging information

## Replit Deployment

For Replit, you may need to:

1. Set `headless: true` in config
2. Install browsers in Replit shell:
```bash
npx playwright install chromium --with-deps
```

3. Use environment variables for sensitive data (proxy credentials)

## VPS Deployment

On a VPS (Ubuntu/Debian):

1. Install dependencies:
```bash
sudo apt-get update
sudo apt-get install -y libnss3 libatk1.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2
```

2. Run normally:
```bash
npm install
npm run install-browsers
npm start
```

## Troubleshooting

### No Images Found

- Check if the product page loads correctly
- Verify network interception is working (check logs)
- Some products may use different API endpoints

### Proxy Issues

- Verify proxy credentials
- Test proxy connectivity separately
- Check if proxy supports HTTPS

### Browser Launch Errors

- Install required system dependencies (see VPS section)
- Try running with `headless: true`
- Check available memory/disk space

### Rate Limiting

- Increase delays between requests
- Use residential proxies
- Reduce concurrent scraping

## Advanced Features

### Custom Image Patterns

Edit the `ImageUrlExtractor` class to add custom URL patterns:

```javascript
const imagePatterns = [
  /your-custom-pattern/gi,
];
```

### Custom Human Behavior

Modify the `HumanBehavior` class to adjust behavior patterns:

```javascript
async customBehavior() {
  // Your custom behavior
}
```

## License

MIT

## Disclaimer

This tool is for educational purposes. Ensure you comply with:
- Alibaba's Terms of Service
- Robots.txt
- Rate limiting best practices
- Local laws and regulations

Always use responsibly and ethically.

