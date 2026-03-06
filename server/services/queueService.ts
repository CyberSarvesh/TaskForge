import redis from "../redis/redisClient.ts";

const QUEUE_NAME = "job_queue";

export const addJobToQueue = async (jobId: string) => {
  await redis.lpush(QUEUE_NAME, jobId);
};

export const getNextJob = async () => {
  const result = await redis.brpop(QUEUE_NAME, 0);
  return result ? result[1] : null;
};