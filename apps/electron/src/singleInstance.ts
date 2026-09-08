export interface SingleInstanceWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export interface SingleInstanceHost {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  onSecondInstance(listener: () => void): void;
}

export function configureSingleInstance(
  host: SingleInstanceHost,
  getWindow: () => SingleInstanceWindow | null,
  createWindow: () => SingleInstanceWindow,
): boolean {
  if (!host.requestSingleInstanceLock()) {
    host.quit();
    return false;
  }

  host.onSecondInstance(() => {
    const mainWindow = getWindow() ?? createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  return true;
}
