const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
  await page.goto('file:///work/poc.html');
  const results = await page.evaluate(() => {
    const cards = document.querySelectorAll('.card');
    return Array.from(cards).map(el => {
      const r = el.getBoundingClientRect();
      const t = (el.querySelector('.card-title')?.textContent?.trim() || 'no-title');
      return { title: t, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
    });
  });
  results.forEach(c => {
    console.log(c.title.padEnd(22) + ' L:' + c.left + '  R:' + c.right + '  W:' + c.width);
  });
  await browser.close();
})();
