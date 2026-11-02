'use strict';
/**
 * 无边框窗口：自绘标题栏、八边缩放、最小尺寸。
 *
 * 用 `frame: false` 换来和 Obsidian 一样的自绘外壳；代价是缩放要自己实现，
 * 所以渲染进程拖动边缘时会把目标 bounds 发给主进程。
 */

const path = require('path');
const { BrowserWindow, screen, ipcMain } = require('electron');

const MIN_W = 640;
const MIN_H = 560;

function createWindow(options = {}) {
  const { width = 1420, height = 900, show = true, offscreen = false } = options;
  const work = screen.getPrimaryDisplay().workArea;
  const x = Math.round(work.x + Math.max(0, (work.width - width) / 2));
  const y = Math.round(work.y + Math.max(0, (work.height - height) / 3));

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: MIN_W,
    minHeight: MIN_H,
    frame: false,
    show: false,
    skipTaskbar: !show,        // 自检/截图用的隐藏窗口不进任务栏、不占屏幕
    backgroundColor: '#161616',
    title: 'For You Notes',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      offscreen,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  if (show) {
    win.once('ready-to-show', () => win.show());
  }

  // 最大化时把客户区对齐工作区（无边框窗口默认会盖住任务栏）
  win.on('maximize', () => {
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    win.setBounds(area);
  });

  // 通知渲染进程：当前窗口是屏幕一半（Windows 贴边）还是全屏 / 最大化
  let stateTimer = null;
  const pushWindowState = () => {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => {
      if (win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
      const b = win.getBounds();
      const area = screen.getDisplayMatching(b).workArea;
      const tol = 8;
      const fullW = Math.abs(b.width - area.width) <= tol;
      const fullH = Math.abs(b.height - area.height) <= tol;
      const full = win.isFullScreen() || (fullW && fullH);
      const half = !full && (
        (fullH && Math.abs(b.width - Math.round(area.width / 2)) <= tol)
        || (fullW && Math.abs(b.height - Math.round(area.height / 2)) <= tol)
      );
      win.webContents.send('win:state', { half, full });
    }, 80);
  };
  ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']
    .forEach((evt) => win.on(evt, pushWindowState));
  win.webContents.on('did-finish-load', () => setTimeout(pushWindowState, 250));
  if (show) win.once('ready-to-show', () => setTimeout(pushWindowState, 0));

  // 关窗口前先让渲染进程把状态存完（分栏比例、选中项、字号…），
  // 不然刚拖完分栏就点关闭，写入可能还没落盘。
  let flushed = false;
  win.on('close', (e) => {
    if (flushed) return;
    e.preventDefault();
    flushWindow(win).then(() => {
      flushed = true;
      if (!win.isDestroyed()) win.destroy();
    });
  });

  return win;
}

/** 让渲染进程存一次盘；700ms 没回应就当作存过了，别卡住窗口 */
function flushWindow(win) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) { resolve(); return; }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ipcMain.removeListener('app:flush-done', finish);
      resolve();
    };
    const timer = setTimeout(finish, 700);
    ipcMain.once('app:flush-done', finish);
    try {
      win.webContents.send('app:flush');
    } catch (_e) {
      finish();
    }
  });
}

function clampBounds(bounds) {
  const area = screen.getDisplayMatching(bounds).workArea;
  const w = Math.max(MIN_W, Math.min(Math.round(bounds.width), area.width));
  const h = Math.max(MIN_H, Math.min(Math.round(bounds.height), area.height));
  const x = Math.round(Math.min(Math.max(bounds.x, area.x - 40), area.x + area.width - 80));
  const y = Math.round(Math.min(Math.max(bounds.y, area.y), area.y + area.height - 60));
  return { x, y, width: w, height: h };
}

module.exports = { createWindow, clampBounds, flushWindow, MIN_W, MIN_H };
