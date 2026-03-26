const { app, BrowserWindow, ipcMain, Notification, session } = require('electron');
const path = require('path');

// Necesario para notificaciones en Windows
app.setAppUserModelId("com.war.chat");

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    frame: false,
    backgroundColor: '#0f172a',
  });

  // Atajo para abrir consola en producción (Ctrl+Shift+I)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.openDevTools();
      event.preventDefault();
    }
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.on('ready', () => {
  // Manejador de permisos robusto
  try {
    const { session } = require('electron');
    const ses = session.defaultSession;

    if (ses) {
      if (typeof ses.setPermissionHandler === 'function') {
        ses.setPermissionHandler((webContents, permission, callback) => {
          const allowed = ['media', 'notifications', 'audio', 'video'];
          callback(allowed.includes(permission));
        });
        console.log('Permission handler set successfully (setPermissionHandler)');
      } else if (typeof ses.setPermissionRequestHandler === 'function') {
        ses.setPermissionRequestHandler((webContents, permission, callback) => {
          const allowed = ['media', 'notifications', 'audio', 'video'];
          callback(allowed.includes(permission));
        });
        console.log('Permission handler set successfully (setPermissionRequestHandler)');
      }
    }
  } catch (err) {
    console.error('Error setting permission handler:', err);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.on('show-notification', (event, { title, body }) => {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch (err) {
    console.error('Notification error:', err);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
