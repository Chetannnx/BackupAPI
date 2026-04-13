const sql = require("mssql/msnodesqlv8");

const config = {
  server: "DESKTOP-EQ55Q8H\\SQLEXPRESS",
  database: "master",
  driver: "msnodesqlv8",
  options: {
    trustedConnection: true
  }
};

module.exports = {
  sql,
  config
};