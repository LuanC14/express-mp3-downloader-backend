const express = require('express');
const fs = require('fs');
const router = express.Router();
const { downloadVideo, downloadPlaylist } = require('../services/downloader');
const { VIDEO_REGEX, PLAYLIST_REGEX } = require('../validation/urls');

router.post('/video', async (req, res) => {
  const { url } = req.body;
  if (!url || !VIDEO_REGEX.test(url))
    return res.status(400).json({ error: 'URL de vídeo inválida.' });

  try {
    const filePath = await downloadVideo(url);
    res.download(filePath, 'audio.mp3', () => fs.unlink(filePath, () => {}));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/playlist', async (req, res) => {
  const { url } = req.body;
  if (!url || !PLAYLIST_REGEX.test(url))
    return res.status(400).json({ error: 'URL de playlist inválida.' });

  try {
    const filePath = await downloadPlaylist(url);
    res.download(filePath, 'playlist.zip', () => fs.unlink(filePath, () => {}));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
