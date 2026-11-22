# Free public demo on Render

One container runs Postgres, Redis, the API and three workers on Render's free web service
(0.1 CPU, 512 MB). For real use, run `compose.yaml` or managed databases.

## Deploy

1. Merge to `main` and wait for CI to pass.
2. Sign up at [render.com](https://dashboard.render.com/register) with GitHub. **Don't add a card.**
   Without one Render suspends the service at a limit. With one it bills you.
3. Choose **New**, then **Blueprint**, and select this repository.
4. Check that the instance type says **Free**, then apply.
5. Open the `onrender.com` address Render shows. It may differ from `taskforge.onrender.com` if that
   name is taken. Nothing needs configuring either way.

Later pushes to `main` deploy once CI passes.

## Check after the first deploy

- The floor shows three workers. **Rush order** works, and so does **Kill**.
- **New job** shows a locked email field. If it can be edited, `PUBLIC_DEMO` is off.
- Rate limits are per visitor. Hold refresh until you get a 429, then open the site on mobile data.
  It should still load. If it doesn't, Render is no longer sending `CF-Connecting-IP`, and
  `CLIENT_IP_HEADER` needs changing. That header is observed behavior, not documented by Render.

## Custom domain

Add it in the Render dashboard, then set the environment variable `EXTRA_HOSTS` to the domain, for
example `taskforge.example.com`. Separate several with commas.

## What to expect

| | |
| --- | --- |
| Sleep | After 15 minutes without requests |
| Wake-up | Render quotes about a minute. At 0.1 CPU the app itself took 13 to 18 seconds to answer and about 50 until all workers were up |
| Data | Reset on every sleep, restart and deploy |
| Hours | 750 a month, enough for one service. Other free services in the workspace share them |
| Bandwidth | 5 GB a month. A two minute visit measured about 0.5 MB, so very roughly 10,000 visits |

Because it sleeps, put the GIF from `docs/demo.gif` next to the link wherever you share it.

## Guardrails

`PUBLIC_DEMO=true` is set in the image.

- Typed text is replaced with samples and never stored. Idempotency keys are stored as digests.
- Each address gets 15 writes, then one every 3 seconds, and 120 reads, then 3 a second.
- At most 150 active jobs, 25 hash rounds, 10 seconds of fault work, 5 attempts and 60 seconds of delay.
- Job lookups have a concurrency cap, and viewers share one snapshot query a second.
- One worker can be killed at a time.
- The newest 1,000 finished jobs and 20,000 events are kept.
- Live updates stop in hidden tabs and after five idle minutes.

These stop casual abuse. They cannot stop a determined attacker from using up the bandwidth
allowance, in which case Render suspends the demo until the next month.

Visitors share one queue, so they can see, cancel and requeue each other's sample jobs.

## Test the image locally

```sh
docker build -f deploy/render/Dockerfile -t taskforge-demo .
sh deploy/render/smoke.sh taskforge-demo
```

To feel what visitors will, run it at Render's size:

```sh
docker run --rm --cpus 0.1 --memory 512m -p 127.0.0.1:10000:10000 taskforge-demo
```
