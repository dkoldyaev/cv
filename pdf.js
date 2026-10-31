const puppeteer = require('puppeteer');

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
  }
  return browserPromise;
}

async function generatePdfFromHtml(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Hide top actions in print
    await page.setContent(html, {
      waitUntil: 'networkidle0'
    });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '15mm',
        right: '15mm',
        bottom: '15mm',
        left: '15mm'
      }
    });
    return pdfBuffer;
  } finally {
    await page.close();
  }
}

module.exports = {
  generatePdfFromHtml
};
