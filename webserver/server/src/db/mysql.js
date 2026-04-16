import mysql from "mysql2/promise";

export function createMysqlPool(config) {
  return mysql.createPool({
    uri: config.mysqlUrl,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4"
  });
}

