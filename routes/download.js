const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const ffmpegPath = require('ffmpeg-static');
const archiver = require('archiver');

const ytDlpBin = path.join(
  path.dirname(require.resolve('youtube-dl-exec/package.json')),
  'bin',
  process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
);

const ffmpegDir = path.dirname(ffmpegPath);

// ---------------------------------------------------------------------------
// Job store
// ---------------------------------------------------------------------------

const jobs = new Map();
const JOB_TTL_MS = 15 * 60 * 1000;

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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VIDEO_REGEX =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/;

const PLAYLIST_REGEX =
  /^(https?:\/\/)?(www\.)?youtube\.com\/(playlist\?list=|watch\?[^#]*list=)[\w-]+/;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.post('/video', (req, res) => {
  const { url } = req.body;
  if (!url || !VIDEO_REGEX.test(url))
    return res.status(400).json({ error: 'URL de vídeo inválida.' });

  const jobId = createJob();
  res.json({ jobId });
  runVideo(jobId, url);
});

router.post('/playlist', (req, res) => {
  const { url } = req.body;
  if (!url || !PLAYLIST_REGEX.test(url))
    return res.status(400).json({ error: 'URL de playlist inválida.' });

  const jobId = createJob();
  res.json({ jobId });
  runPlaylist(jobId, url);
});

// SSE — progresso em tempo real
router.get('/progress/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Job já terminou — replay imediato
  if (job.lastEvent?.type === 'done' || job.lastEvent?.type === 'error') {
    res.write(`data: ${JSON.stringify(job.lastEvent)}\n\n`);
    res.end();
    return;
  }

  // Envia último progresso conhecido para o cliente entrar já com o valor atual
  if (job.lastEvent) res.write(`data: ${JSON.stringify(job.lastEvent)}\n\n`);

  job.clients.push(res);
  req.on('close', () => { job.clients = job.clients.filter(c => c !== res); });
});

// Envio do arquivo final
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

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

function runVideo(jobId, url) {
  const job = jobs.get(jobId);
  const fileId = uuidv4();
  const outputDir = os.tmpdir();
  const outputTemplate = path.join(outputDir, `${fileId}.%(ext)s`);

  const proc = spawn(ytDlpBin, [
    url,
    '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K',
    '--output', outputTemplate,
    '--no-playlist',
    '--ffmpeg-location', ffmpegDir,
    '--newline',
  ]);

  const onData = (data) => {
    const match = data.toString().match(/(\d+\.?\d*)%/);
    if (match) emit(jobId, { type: 'progress', percent: Math.min(Math.round(parseFloat(match[1])), 99) });
  };

  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('close', (code) => {
    const mp3Path = path.join(outputDir, `${fileId}.mp3`);
    if (code === 0 && fs.existsSync(mp3Path)) {
      job.status = 'done';
      job.filePath = mp3Path;
      emit(jobId, { type: 'done', jobId });
    } else {
      job.status = 'error';
      emit(jobId, { type: 'error', message: 'Falha no download. Verifique se o vídeo está disponível.' });
    }
  });

  proc.on('error', () => emit(jobId, { type: 'error', message: 'Erro ao iniciar o yt-dlp.' }));
}

function runPlaylist(jobId, url) {
  const job = jobs.get(jobId);
  const sessionDir = path.join(os.tmpdir(), uuidv4());
  fs.mkdirSync(sessionDir, { recursive: true });

  let totalItems = 0;
  let currentItem = 0;
  let currentItemPercent = 0;

  const proc = spawn(ytDlpBin, [
    url,
    '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K',
    '--output', path.join(sessionDir, '%(playlist_index)s - %(title)s.%(ext)s'),
    '--ffmpeg-location', ffmpegDir,
    '--newline',
    '--yes-playlist',
  ]);

  const onData = (data) => {
    for (const line of data.toString().split('\n')) {
      const itemMatch = line.match(/Downloading item (\d+) of (\d+)/);
      if (itemMatch) {
        currentItem = parseInt(itemMatch[1]);
        totalItems = parseInt(itemMatch[2]);
        currentItemPercent = 0;
      }

      const pctMatch = line.match(/(\d+\.?\d*)%/);
      if (pctMatch) currentItemPercent = parseFloat(pctMatch[1]);

      if (totalItems > 0) {
        const overall = ((currentItem - 1 + currentItemPercent / 100) / totalItems) * 100;
        emit(jobId, {
          type: 'progress',
          percent: Math.min(Math.round(overall), 99),
          label: `${currentItem} de ${totalItems} faixas`,
        });
      }
    }
  };

  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('close', (code) => {
    if (code !== 0) {
      fs.rm(sessionDir, { recursive: true }, () => {});
      emit(jobId, { type: 'error', message: 'Falha no download da playlist.' });
      return;
    }

    const zipPath = path.join(os.tmpdir(), `${uuidv4()}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 0 } });

    output.on('close', () => {
      job.status = 'done';
      job.filePath = zipPath;
      job.isPlaylist = true;
      fs.rm(sessionDir, { recursive: true }, () => {});
      emit(jobId, { type: 'done', jobId });
    });

    archive.on('error', () => {
      fs.rm(sessionDir, { recursive: true }, () => {});
      emit(jobId, { type: 'error', message: 'Erro ao compactar a playlist.' });
    });

    archive.pipe(output);
    archive.directory(sessionDir, false);
    archive.finalize();
  });

  proc.on('error', () => emit(jobId, { type: 'error', message: 'Erro ao iniciar o yt-dlp.' }));
}

module.exports = router;
