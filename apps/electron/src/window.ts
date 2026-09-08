import { app, BrowserWindow, nativeImage } from "electron";
import * as fs from "fs";
import * as path from "path";

export interface CreateWindowOptions {
  isDev: boolean;
  onClosed: () => void;
}

function getWindowIcon() {
  let iconPath = path.join(__dirname, "assets", "icon.png");

  if (!fs.existsSync(iconPath)) {
    iconPath = path.join(__dirname, "..", "assets", "icon.png");
  }

  const img = nativeImage.createFromPath(iconPath);
  return img.isEmpty() ? null : img;
}

export function createWindow({
  isDev,
  onClosed,
}: CreateWindowOptions): BrowserWindow {
  const windowIcon = getWindowIcon() || undefined;
  const isWindows = process.platform === "win32";

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // 窗口最小宽度 = Web 桌面内容下限(apps/web App.css 的 .app[data-layout-mode="desktop"] = 1080:
    // 文件栏 256 + 编辑器 ≥340 + 分隔条 16 + 预览画布 ≥402 + 留白)再加约 20px 窗口余量,
    // 避免边缘触发横向滚动,并保证拖到最窄时预览 402px 画布不被挤压
    minWidth: 1100,
    minHeight: 640,
    title: "MPForge",
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: "hidden",
    frame: !isWindows,
    titleBarOverlay: isWindows
      ? false
      : {
          color: "#f5f7f9",
          symbolColor: "#2c2c2c",
          height: 48,
        },
    trafficLightPosition: { x: 20, y: 28 },
    show: false,
  });

  const startUrl = process.env.ELECTRON_START_URL
    ? process.env.ELECTRON_START_URL
    : isDev
      ? "http://localhost:5173"
      : `file://${path.join(process.resourcesPath, "web-dist", "index.html")}`;

  console.log("[MPForge] Loading URL:", startUrl);
  console.log("[MPForge] isDev:", isDev);
  console.log("[MPForge] resourcesPath:", process.resourcesPath);

  mainWindow.loadURL(startUrl);

  mainWindow.once("ready-to-show", () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on("closed", onClosed);

  return mainWindow;
}

export function configureAppIdentity(): void {
  app.setName("MPForge");
  app.setAppUserModelId("io.github.mpforge.desktop");
}
