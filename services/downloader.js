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

function downloadVideo(url) {
  return new Promise((resolve, reject) => {
    const fileId = uuidv4();
    const outputDir = os.tmpdir();

    const proc = spawn(ytDlpBin, [
      url,
      '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K',
      '--output', path.join(outputDir, `${fileId}.%(ext)s`),
      '--no-playlist',
      '--ffmpeg-location', ffmpegDir,
      '--newline',
    ]);

    proc.on('close', (code) => {
      const mp3Path = path.join(outputDir, `${fileId}.mp3`);
      if (code === 0 && fs.existsSync(mp3Path)) return resolve(mp3Path);
      reject(new Error('Falha no download. Verifique se o vídeo está disponível.'));
    });

    proc.on('error', () => reject(new Error('Erro ao iniciar o yt-dlp.')));
  });
}

function downloadPlaylist(url) {
  return new Promise((resolve, reject) => {
    const sessionDir = path.join(os.tmpdir(), uuidv4());
    fs.mkdirSync(sessionDir, { recursive: true });

    const proc = spawn(ytDlpBin, [
      url,
      '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K',
      '--output', path.join(sessionDir, '%(playlist_index)s - %(title)s.%(ext)s'),
      '--ffmpeg-location', ffmpegDir,
      '--newline',
      '--yes-playlist',
    ]);

    proc.on('close', (code) => {
      if (code !== 0) {
        fs.rm(sessionDir, { recursive: true }, () => {});
        return reject(new Error('Falha no download da playlist.'));
      }

      const zipPath = path.join(os.tmpdir(), `${uuidv4()}.zip`);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 0 } });

      output.on('close', () => {
        fs.rm(sessionDir, { recursive: true }, () => {});
        resolve(zipPath);
      });

      archive.on('error', () => {
        fs.rm(sessionDir, { recursive: true }, () => {});
        reject(new Error('Erro ao compactar a playlist.'));
      });

      archive.pipe(output);
      archive.directory(sessionDir, false);
      archive.finalize();
    });

    proc.on('error', () => {
      fs.rm(sessionDir, { recursive: true }, () => {});
      reject(new Error('Erro ao iniciar o yt-dlp.'));
    });
  });
}

module.exports = { downloadVideo, downloadPlaylist };
