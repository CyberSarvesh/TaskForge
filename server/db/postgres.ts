import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();


const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: 5432,
  user: process.env.PGADMIN_USERNAME || "postgres",
  password: process.env.PGADMIN_PASSWORD || "postgres",
  database: process.env.PGDATABASE || "TaskForge",
});

pool.on("connect", () => {
  console.log("PostgreSQL connected");
});

export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};

export default pool;