# TaskForge
# 📝 Description

TaskForge is a lightweight background job processing system that allows a backend server to handle long-running tasks asynchronously without blocking incoming client requests.

In a typical web application, the server processes requests synchronously. If a request triggers a heavy task—such as sending emails, generating reports, or processing files—the server must wait until the task finishes before responding. This can slow down the application and reduce its ability to handle many users simultaneously.

TaskForge solves this problem by introducing a job queue and worker system.

When a client sends a request that creates a task, the API server stores the job metadata in a PostgreSQL database and pushes the job ID into a Redis queue. Instead of executing the task immediately, the server returns a response quickly, allowing it to remain responsive to other clients.

A separate worker process runs independently from the API server. The worker continuously listens to the Redis queue for new jobs. When a job appears, the worker retrieves its metadata from the database, executes the corresponding task (such as sending an email or generating a report), and updates the job status in PostgreSQL.

This architecture allows the application to scale efficiently by running multiple worker processes that can handle jobs in parallel.

---

# 🗺️ Architecture Model Diagram

---

# 🚀 Features

* Asynchronous background job processing

* Redis-based job queue

* Worker-based task execution

* Persistent job storage using PostgreSQL

* Job status tracking

* Modular job handler architecture

* Easily scalable with multiple workers


---

# 🛠 Tech Stack

* Node.js

* Express

* TypeScript ( type safety )

* Redis (for job queue)

* PostgreSQL (job metadata storage)

* Docker (optional for Redis/Postgres containers and deployment of worker nodes if needed)

---------

# ⚙️ How It Works

* A client sends a request to create a job.

* The API server stores the job in PostgreSQL.

* The job ID is pushed to a Redis queue.

* A worker process listens to the queue.

* The worker retrieves the job and executes the appropriate job handler.

* The job status is updated in the database.

# ▶️ Running The Project Instructions

Download the Dependencies

```
cd server
npm i
```
Start the server
```
npx ts-node api/server.ts
```
Run the Workers

```
npx ts-node worker/worker.ts
```
