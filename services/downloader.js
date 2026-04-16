const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const ffmpegPath = require('ffmpeg-static');
const archiver = require('archiver');
const { jobs, concurrency, emit } = require('./jobStore');

const ytDlpBin = path.join(
  path.dirname(require.resolve('youtube-dl-exec/package.json')),
  'bin',
  process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
);
const ffmpegDir = path.dirname(ffmpegPath);

function runVideo(jobId, url) {
  const job = jobs.get(jobId);
  const fileId = uuidv4();
  const outputDir = os.tmpdir();
  const outputTemplate = path.join(outputDir, `${fileId}.%(ext)s`);

  concurrency.active++;
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
    concurrency.active--;
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

  proc.on('error', () => {
    concurrency.active--;
    emit(jobId, { type: 'error', message: 'Erro ao iniciar o yt-dlp.' });
  });
}

function runPlaylist(jobId, url) {
  const job = jobs.get(jobId);
  const sessionDir = path.join(os.tmpdir(), uuidv4());
  fs.mkdirSync(sessionDir, { recursive: true });

  concurrency.active++;
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
    concurrency.active--;
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

  proc.on('error', () => {
    concurrency.active--;
    emit(jobId, { type: 'error', message: 'Erro ao iniciar o yt-dlp.' });
  });
}

module.exports = { runVideo, runPlaylist };
