const express = require("express");
const cors = require("cors");
const { sql, config } = require("./db");
const fs = require("fs");
const path = require("path");

const app = express();

// ==========================
// 🔥 MIDDLEWARE
// ==========================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"]
}));

app.use(express.json());

// ==========================
// 🔥 CONFIG
// ==========================
const BACKUP_FOLDER = "D:\\Chetan\\DBBackup";

// ==========================
// 🔥 CREATE BACKUP FOLDER
// ==========================
if (!fs.existsSync(BACKUP_FOLDER)) {
  fs.mkdirSync(BACKUP_FOLDER, { recursive: true });
}

// ==========================
// 🔥 COMMON DB LOGGER
// ==========================
async function logOperation(type, status, filePath = null) {
  let pool;
  try {
    pool = await sql.connect(config);

    await pool.request()
      .input("type", sql.VarChar, type)
      .input("status", sql.VarChar, status)
      .input("path", sql.NVarChar, filePath)
      .query(`
        INSERT INTO master.dbo.BackupLogs 
        (OperationType, Status, BackupFilePath)
        VALUES (@type, @status, @path)
      `);

  } catch (err) {
    console.error("❌ Log Error:", err.message);
  } finally {
    if (pool) await pool.close();
  }
}

// ==========================
// 🔥 GET LATEST BACKUP FILE
// ==========================
function getLatestBackup() {
  const files = fs.readdirSync(BACKUP_FOLDER)
    .filter(f => f.endsWith(".bak"))
    .map(f => ({
      name: f,
      time: fs.statSync(path.join(BACKUP_FOLDER, f)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);

  return files.length ? files[0].name : null;
}

// ==========================
// 🔥 BACKUP API (AUTO / MANUAL)
// ==========================
app.post("/api/backup", async (req, res) => {
  let pool;
  const type = req.body.type || "MANUAL";

  try {
    pool = await sql.connect(config);

    const fileName = `NexusSQLDB_${Date.now()}.bak`;
    const filePath = path.join(BACKUP_FOLDER, fileName);
    const sqlPath = filePath.replace(/\\/g, "\\\\");

    const query = `
      BACKUP DATABASE NexusSQLDB
      TO DISK = N'${sqlPath}'
      WITH FORMAT, INIT;
    `;

    await pool.request().query(query);

    // ✅ LOG SUCCESS
    await logOperation(type, "SUCCESS", filePath);

    res.json({
      success: true,
      message: `${type} backup successful`,
      file: fileName
    });

  } catch (err) {
    console.error("❌ Backup Error:", err);

    // ❌ LOG FAILED
    await logOperation(type, "FAILED", null);

    res.status(500).json({
      success: false,
      message: err.message
    });

  } finally {
    if (pool) await pool.close();
  }
});

// ==========================
// 🔥 GET ALL BACKUPS
// ==========================
app.get("/api/backups", (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_FOLDER)
      .filter(f => f.endsWith(".bak"))
      .map(f => ({
        name: f,
        time: fs.statSync(path.join(BACKUP_FOLDER, f)).mtime
      }))
      .sort((a, b) => b.time - a.time);

    res.json(files);

  } catch (err) {
    res.status(500).json({ message: "Failed to read backups" });
  }
});

// ==========================
// 🔥 RESTORE API
// ==========================
app.post("/api/restore", async (req, res) => {
  let pool;
  let filePath = req.body.path;

  try {
    pool = await sql.connect(config);

    // 🔹 If no file → latest backup
    if (!filePath) {
      const latestFile = getLatestBackup();

      if (!latestFile) {
        return res.status(404).json({
          success: false,
          message: "No backup found"
        });
      }

      filePath = path.join(BACKUP_FOLDER, latestFile);
    }

    // 🔹 Check file exists
    if (!fs.existsSync(filePath)) {
      return res.status(400).json({
        success: false,
        message: "Backup file not found",
        path: filePath
      });
    }

    const sqlPath = filePath.replace(/\\/g, "\\\\");

    const query = `
  USE master;

  -- Kill all connections safely
  ALTER DATABASE NexusSQLDB 
  SET SINGLE_USER WITH ROLLBACK IMMEDIATE;

  -- Restore with progress
  RESTORE DATABASE NexusSQLDB
  FROM DISK = N'${sqlPath}'
  WITH REPLACE, RECOVERY, STATS = 10;

  -- Set back to multi user
  ALTER DATABASE NexusSQLDB 
  SET MULTI_USER;
`;

    await pool.request().query(query);

    // ✅ LOG SUCCESS
    await logOperation("RESTORE", "SUCCESS", filePath);

    res.json({
      success: true,
      message: "Restore successful",
      file: filePath
    });

  } catch (err) {
    console.error("❌ Restore Error:", err);

    // ❌ LOG FAILED
    await logOperation("RESTORE", "FAILED", filePath || null);

    res.status(500).json({
      success: false,
      message: err.message
    });

  } finally {
    if (pool) await pool.close();
  }
});

// ==========================
// 🔥 STATUS API (LATEST TIMES)
// ==========================
app.get("/api/status", async (req, res) => {
  let pool;

  try {
    pool = await sql.connect(config);

    const result = await pool.request().query(`
      SELECT OperationType, MAX(CreatedAt) AS LastTime
      FROM master.dbo.BackupLogs
      WHERE Status = 'SUCCESS'
      GROUP BY OperationType
    `);

    const data = {
      auto: null,
      manual: null,
      restore: null
    };

    result.recordset.forEach(row => {
      if (row.OperationType === "AUTO") data.auto = row.LastTime;
      if (row.OperationType === "MANUAL") data.manual = row.LastTime;
      if (row.OperationType === "RESTORE") data.restore = row.LastTime;
    });

    res.json(data);

  } catch (err) {
    console.error("❌ Status Error:", err);
    res.status(500).json({ message: "Status fetch failed" });

  } finally {
    if (pool) await pool.close();
  }
});


app.get("/api/files", (req, res) => {
  const requestedPath = req.query.path || "D:\\";

  try {
    const items = fs.readdirSync(requestedPath).map(name => {
      const fullPath = path.join(requestedPath, name);
      const isDir = fs.statSync(fullPath).isDirectory();

      return {
        name,
        path: fullPath,
        type: isDir ? "folder" : "file"
      };
    });

    res.json({
      currentPath: requestedPath,
      items
    });

  } catch (err) {
    res.status(500).json({ message: "Cannot read path" });
  }
});

// ==========================
// 🔥 START SERVER
// ==========================
const PORT = 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});