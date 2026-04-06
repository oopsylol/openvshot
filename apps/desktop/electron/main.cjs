const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function defaultPythonCommand() {
  if (process.platform === "win32") {
    return "python";
  }
  return "python3";
}

function packagedBinaryNames() {
  if (process.platform === "win32") {
    return ["vshot.exe"];
  }
  return ["vshot"];
}

function resolveCliTarget() {
  if (app.isPackaged) {
    for (const binaryName of packagedBinaryNames()) {
      const packagedBinary = path.join(process.resourcesPath, "backend", binaryName);
      if (fs.existsSync(packagedBinary)) {
        return {
          command: packagedBinary,
          bootstrapArgs: [],
        };
      }
    }
    const packagedScript = path.join(process.resourcesPath, "backend", "scu_cli.py");
    if (process.env.OPENVSHOT_ALLOW_SCRIPT_FALLBACK === "1" && fs.existsSync(packagedScript)) {
      return {
        command: process.env.OPENVSHOT_PYTHON || defaultPythonCommand(),
        bootstrapArgs: [packagedScript],
      };
    }
    const expectedName = packagedBinaryNames()[0];
    throw new Error(
      `Packaged CLI binary is missing: ${path.join(process.resourcesPath, "backend", expectedName)}`
    );
  }
  return {
    command: process.env.OPENVSHOT_PYTHON || defaultPythonCommand(),
    bootstrapArgs: [path.resolve(__dirname, "../../../backend/scu_cli.py")],
  };
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    window.loadURL(devServerUrl);
    return;
  }
  window.loadFile(path.join(__dirname, "../dist/index.html"));
}

ipcMain.handle("cli:exec", async (_event, payload) => {
  const command = String(payload?.command || "").trim();
  const args = Array.isArray(payload?.args) ? payload.args.map((item) => String(item)) : [];
  const jsonMode = payload?.jsonMode !== false;
  const timeoutMs = Number(payload?.timeoutMs || 120000);
  const extraEnv = payload?.env && typeof payload.env === "object" ? payload.env : {};
  if (!command) {
    throw new Error("缺少命令");
  }
  const cliTarget = resolveCliTarget();
  const cliArgs = [...cliTarget.bootstrapArgs];
  if (jsonMode) {
    cliArgs.push("--json");
  }
  cliArgs.push(command, ...args);
  return await new Promise((resolve, reject) => {
    const child = spawn(cliTarget.command, cliArgs, {
      cwd: path.resolve(__dirname, "../../.."),
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        ...extraEnv,
      },
      windowsHide: true,
    });
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      try {
        child.kill();
      } catch {}
      reject(new Error(`命令执行超时（${Math.floor(timeoutMs / 1000)}s）：${command}`));
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code: typeof code === "number" ? code : -1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
});

ipcMain.handle("dialog:pick-directory", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择项目目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { canceled: true, path: "" };
  }
  return { canceled: false, path: String(result.filePaths[0] || "") };
});

ipcMain.handle("dialog:pick-image-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择人物参考图",
    properties: ["openFile"],
    filters: [
      { name: "图片文件", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { canceled: true, path: "" };
  }
  return { canceled: false, path: String(result.filePaths[0] || "") };
});

ipcMain.handle("app:open-devtools", () => {
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target) {
    return { ok: false, message: "未找到窗口" };
  }
  target.webContents.openDevTools({ mode: "detach" });
  return { ok: true };
});

ipcMain.handle("file:read-data-url", async (_event, payload) => {
  const input = String(payload?.filePath || "").trim();
  if (!input) {
    return { ok: false, message: "缺少 filePath", dataUrl: "" };
  }
  const target = path.isAbsolute(input) ? input : path.resolve(__dirname, "../../..", input);
  if (!fs.existsSync(target)) {
    return { ok: false, message: `文件不存在: ${target}`, dataUrl: "" };
  }
  const ext = path.extname(target).toLowerCase();
  const mimeByExt = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".m4v": "video/x-m4v",
  };
  const mime = mimeByExt[ext] || "application/octet-stream";
  const data = fs.readFileSync(target);
  return { ok: true, filePath: target, dataUrl: `data:${mime};base64,${data.toString("base64")}` };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
