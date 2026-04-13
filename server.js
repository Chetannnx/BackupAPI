const express = require("express");
const cors = require("cors");
const { sql, config } = require("./db");
const fs = require("fs");
const path = require("path");

const app = express();

// ✅ Middleware
// app.use(cors({
//   origin: "http://127.0.0.1:5501",
//   methods: ["GET", "POST"],
//   credentials: true
// }));

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
}));

app.use(express.json());

// 🔥 Backup folder
const BACKUP_FOLDER = "D:\\Chetan\\DBBackup";

// ==========================
// 🔥 CREATE FOLDER IF NOT EXISTS
// ==========================
if (!fs.existsSync(BACKUP_FOLDER)) {
  fs.mkdirSync(BACKUP_FOLDER, { recursive: true });
}

// ==========================
// 🔥 BACKUP API
// ==========================
app.post("/api/backup", async (req, res) => {
  let pool;

  try {
    pool = await sql.connect(config);

    const fileName = `NexusSQLDB_${Date.now()}.bak`;
    let filePath = path.join(BACKUP_FOLDER, fileName);

    const sqlPath = filePath.replace(/\\/g, "\\\\");

    const query = `
      BACKUP DATABASE NexusSQLDB
      TO DISK = N'${sqlPath}'
      WITH FORMAT, INIT;
    `;

    await pool.request().query(query);

    res.json({
      success: true,
      message: "Backup created successfully",
      file: fileName
    });

  } catch (err) {
    console.error("❌ Backup Error FULL:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });

  } finally {
    if (pool) await pool.close();   // 🔥 IMPORTANT
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
// 🔥 GET LATEST BACKUP
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
// 🔥 RESTORE API
// ==========================
app.post("/api/restore", async (req, res) => {
  let pool;

  try {
    pool = await sql.connect(config); // 🔥 now connected to MASTER

    let filePath = req.body.path;

    // ✅ If no path → latest backup
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

    // ✅ Check file exists
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

      ALTER DATABASE NexusSQLDB
      SET SINGLE_USER WITH ROLLBACK IMMEDIATE;

      RESTORE DATABASE NexusSQLDB
      FROM DISK = N'${sqlPath}'
      WITH REPLACE;

      ALTER DATABASE NexusSQLDB
      SET MULTI_USER;
    `;

    await pool.request().query(query);

    res.json({
      success: true,
      message: "Database restored successfully",
      file: filePath
    });

  } catch (err) {
    console.error("❌ Restore Error FULL:", err);

    res.status(500).json({
      success: false,
      message: err.message,
      details: err.originalError?.message || ""
    });

  } finally {
    if (pool) await pool.close();   // 🔥 VERY IMPORTANT
  }
});

// ==========================
// 🔥 START SERVER
// ==========================
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});