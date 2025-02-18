const { app, BrowserWindow, shell, Tray, Menu } = require("electron");
const { autoUpdater } = require("electron-updater")

const path = require("path");
const url = require("url");
const os = require('os');

const GUN_PORT = 8767;

const Gun = require("gun");
const publicIp = require('public-ip');

const natpmp = require('nat-pmp');
const natpmp_client = natpmp.connect('10.0.1.1');
natpmp_client.portMapping({ private: GUN_PORT, public: GUN_PORT, ttl: 3600 }, function (err, info) {
  if (err) console.error(err);
  console.log(info);
});

const publicServer = require('http').createServer(Gun.serve);
const localServer = require('http').createServer(Gun.serve);
const userDataPath = app.getPath('userData');
const icon = path.join(__dirname, 'iris-messenger/src/img/icon128.png');

let win, publicState, localState, isQuiting, settings = { minimizeOnClose: true, openAtLogin: !process.env.DEV };
let tray = null;

function createGun() {
	publicState = Gun({file: userDataPath + '/radata', web: publicServer.listen(GUN_PORT), multicast: { port: 8765 } });
	console.log('Relay peer started on port ' + GUN_PORT + ' with /gun');
	localState = Gun({file: userDataPath + '/localState', web: localServer.listen(8768, '127.0.0.1'), multicast: false, peers: [] }).get('state'); // IMPORTANT: only listen on 127.0.0.1
	localState.get('settings').map().on((v, k) => settings[k] = v);
	if (!process.env.DEV) {
		localState.get('settings').get('openAtLogin').on(openAtLogin => {
			app.setLoginItemSettings({
				openAtLogin
			});
		});
	}
	publicIp.v4().then(ip => localState.get('settings').get('publicIp').put(ip)); // TODO: make optional / on demand
	localState.get('platform').put(os.platform());
	localState.get('cmd').on(cmd => {
		if (win && cmd.name && cmd.time && (new Date() - new Date(cmd.time) < 1000)) {
			switch (cmd.name) {
				case 'minimize':
					win.minimize();
					break;
				case 'maximize':
					win.isMaximized() ? win.unmaximize() : win.maximize();
					break;
				case 'close':
					win.close();
			}
		}
	});
}

function createWindow() {
	win = new BrowserWindow({
		width: 1024,
		height: 768,
		webPreferences: {nodeIntegration: false},
		icon,
		titleBarStyle: 'hiddenInset',
		transparent: true,
		frame: false
	});

  if (process.platform !== 'darwin') {
    tray = new Tray(icon);

  	let trayMenu = [
  		{
  			label: 'Quit',
  			type: 'normal',
  			click: () => app.quit()
  		}
  	]

  	// Left click on tray icon opens the app
  	if (process.platform === 'win32') {
  		tray.on('click', () => {
  			win.show();
  		});
  	}
  	// Set the Tray menu with the variable "trayMenu"
  	const menu = Menu.buildFromTemplate(trayMenu);
  	tray.setContextMenu(menu);
  }

	win.removeMenu();

	// load the application source
	win.loadURL(
		url.format({
			pathname: path.join(__dirname, `iris-messenger/src/index.html`),
			protocol: "file:",
			slashes: true
		})
	);

	// The following is optional and will open the DevTools:
	if (process.env.DEV) {
		win.webContents.openDevTools();
	}

	win.on("closed", () => {
		win = null;
	});

	win.on('close', (event) => {
		if (!isQuiting && settings.minimizeOnClose) {
			event.preventDefault();
			win.minimize();
			event.returnValue = false;
			win.hide();
		}
	});

	const loginItemSettings = app.getLoginItemSettings();
	if (loginItemSettings.wasOpenedAtLogin) {
		win.minimize();
	}

	win.webContents.on('new-window', function(e, url) {
		e.preventDefault();
		shell.openExternal(url);
	});
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
	console.log('Another instance of Iris is already running');
	app.quit();
} else {
	app.setLoginItemSettings({
		openAtLogin: !process.env.DEV
	});

	app.on("ready", createWindow);
	app.on("ready", createGun);
	app.on('before-quit', function () {
		isQuiting = true;
	});

	// on macOS, closing the window doesn't quit the app
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin" || !settings.minimizeOnClose) {
			app.quit();
		}
	});

	// initialize the app's main window
	app.on("activate", () => {
		if (win === null) {
			createWindow();
		}
	});

	app.on('second-instance', (event, commandLine, workingDirectory) => {
		// Someone tried to run a second instance, we should focus our window.
		if (win) {
			if (win.isMinimized()) { win.restore(); }
			win.focus();
		}
	});

	autoUpdater.checkForUpdatesAndNotify();
}
