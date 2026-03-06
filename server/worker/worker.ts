import redis from "../redis/redisClient.ts";
import { query } from "../db/postgres.ts";
import { getNextJob } from "../services/queueService.ts";

import { emailJob } from "../jobs/emailJob.ts";
import { reportJob } from "../jobs/reportJob.ts";

const startWorker = async () => {
  console.log("Worker started...");

  while (true) {
    const jobId = await getNextJob();

    if (!jobId) continue;

    console.log("Processing job:", jobId);

    const result = await query("SELECT * FROM jobs WHERE id = $1", [jobId]);

    const job = result.rows[0];

    if (!job) {
      console.log("Job not found");
      continue;
    }

    try {
      await query(
        "UPDATE jobs SET status = $1 WHERE id = $2",
        ["processing", jobId]
      );

      if (job.type === "email") {
        await emailJob(job.payload);
      }

      if (job.type === "report") {
        await reportJob(job.payload);
      }

      await query(
        "UPDATE jobs SET status = $1, completed_at = NOW() WHERE id = $2",
        ["completed", jobId]
      );

      console.log("Job completed:", jobId);

    } catch (err) {
      console.error("Job failed:", err);

      await query(
        "UPDATE jobs SET status = $1 WHERE id = $2",
        ["failed", jobId]
      );
    }
  }
};

startWorker();