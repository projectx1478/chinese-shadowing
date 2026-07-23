// playwright.config.js
// index.html をローカルファイルとして直接開いてテストするため、webServerは使わない。
module.exports = {
  testDir: './tests',
  timeout: 15000,
  use: {
    viewport: { width: 390, height: 1000 },
  },
  reporter: [['list']],
};
