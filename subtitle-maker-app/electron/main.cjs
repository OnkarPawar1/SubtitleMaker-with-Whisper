const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const isDev = !app.isPackaged;

function createWindow() {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    autoHideMenuBar: true,
    backgroundColor: '#020617',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173';
    window.loadURL(devUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

async function ensureExtension(filePath, extension) {
  return path.extname(filePath) ? filePath : `${filePath}.${extension}`;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('Bundled FFmpeg is unavailable on this machine.'));
      return;
    }

    const ffmpeg = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `FFmpeg exited with code ${code}`));
    });
  });
}

ipcMain.handle('subtitle-studio:get-export-support', () => ({
  isDesktop: true,
  ffmpegAvailable: Boolean(ffmpegPath),
  platform: process.platform,
}));

ipcMain.handle('subtitle-studio:save-recording', async (_event, payload) => {
  const { arrayBuffer, mimeType, defaultFileName, preferMp4 } = payload;
  const sourceExtension = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const targetExtension = preferMp4 && ffmpegPath ? 'mp4' : sourceExtension;

  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultFileName.endsWith(`.${targetExtension}`)
      ? defaultFileName
      : `${defaultFileName}.${targetExtension}`,
    filters: [
      {
        name: targetExtension === 'mp4' ? 'MP4 Video' : 'WebM Video',
        extensions: [targetExtension],
      },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  const selectedPath = await ensureExtension(filePath, targetExtension);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-studio-'));
  const inputPath = path.join(tempDir, `recording.${sourceExtension}`);

  try {
    await fs.writeFile(inputPath, Buffer.from(arrayBuffer));

    if (targetExtension === 'mp4' && sourceExtension !== 'mp4') {
      await runFfmpeg([
        '-y',
        '-i',
        inputPath,
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        selectedPath,
      ]);
    } else {
      await fs.copyFile(inputPath, selectedPath);
    }

    return { canceled: false, filePath: selectedPath };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

ipcMain.handle('subtitle-studio:reveal-file', async (_event, filePath) => {
  if (!filePath) return false;
  shell.showItemInFolder(filePath);
  return true;
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
