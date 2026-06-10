const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const out = process.argv[2] || path.join(__dirname, '..', 'docs', 'runtime-preview.png');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 430,
    height: 920,
    backgroundColor: '#101214',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise(resolve => setTimeout(resolve, 1400));

  const summary = await win.webContents.executeJavaScript(`({
    title: document.title,
    overview: document.querySelectorAll('#overview .ov-item').length,
    tasks: document.querySelectorAll('.tc').length,
    panels: document.querySelectorAll('.badges').length,
    text: document.body.innerText.slice(0, 120)
  })`);

  const image = await win.capturePage();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.toPNG());
  console.log(JSON.stringify({ out, ...summary }, null, 2));
  app.quit();
}).catch(err => {
  console.error(err);
  app.quit();
  process.exitCode = 1;
});
