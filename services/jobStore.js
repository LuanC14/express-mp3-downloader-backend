const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const jobs = new Map();
const JOB_TTL_MS = 15 * 60 * 1000;

// Mutable object so consumers share the same reference
const concurrency = { active: 0, max: 3 };

function createJob() {
  const id = uuidv4();
  jobs.set(id, {
    id,
    status: 'pending',
    filePath: null,
    isPlaylist: false,
    clients: [],
    lastEvent: null,
  });
  setTimeout(() => {
    const job = jobs.get(id);
    if (job?.filePath) fs.unlink(job.filePath, () => {});
    jobs.delete(id);
  }, JOB_TTL_MS);
  return id;
}

function emit(jobId, event) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.lastEvent = event;
  for (const res of job.clients) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'done' || event.type === 'error') res.end();
  }
  if (event.type === 'done' || event.type === 'error') job.clients = [];
}

module.exports = { jobs, concurrency, createJob, emit };
