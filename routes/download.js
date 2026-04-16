const express = require('express');
const fs = require('fs');
const router = express.Router();
const { jobs, concurrency, createJob } = require('../services/jobStore');
const { runVideo, runPlaylist } = require('../services/downloader');
const { VIDEO_REGEX, PLAYLIST_REGEX } = require('../validation/urls');

const BUSY_ERROR = { error: 'Servidor ocupado. Tente novamente em alguns segundos.' };

router.post('/video', (req, res) => {
  const { url } = req.body;
  if (!url || !VIDEO_REGEX.test(url))
    return res.status(400).json({ error: 'URL de vídeo inválida.' });
  if (concurrency.active >= concurrency.max)
    return res.status(429).json(BUSY_ERROR);

  const jobId = createJob();
  res.json({ jobId });
  runVideo(jobId, url);
});

router.post('/playlist', (req, res) => {
  const { url } = req.body;
  if (!url || !PLAYLIST_REGEX.test(url))
    return res.status(400).json({ error: 'URL de playlist inválida.' });
  if (concurrency.active >= concurrency.max)
    return res.status(429).json(BUSY_ERROR);

  const jobId = createJob();
  res.json({ jobId });
  runPlaylist(jobId, url);
});

router.get('/progress/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (job.lastEvent?.type === 'done' || job.lastEvent?.type === 'error') {
    res.write(`data: ${JSON.stringify(job.lastEvent)}\n\n`);
    res.end();
    return;
  }

  if (job.lastEvent) res.write(`data: ${JSON.stringify(job.lastEvent)}\n\n`);

  job.clients.push(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(heartbeat);
    job.clients = job.clients.filter(c => c !== res);
  });
});

router.get('/file/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'done' || !job.filePath)
    return res.status(404).json({ error: 'Arquivo não disponível.' });

  const filename = job.isPlaylist ? 'playlist.zip' : 'audio.mp3';
  res.download(job.filePath, filename, (err) => {
    fs.unlink(job.filePath, () => {});
    jobs.delete(job.id);
    if (err && !res.headersSent) res.status(500).json({ error: 'Erro ao enviar arquivo.' });
  });
});

module.exports = router;
