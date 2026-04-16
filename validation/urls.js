const VIDEO_REGEX =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/;

const PLAYLIST_REGEX =
  /^(https?:\/\/)?(www\.)?youtube\.com\/(playlist\?list=|watch\?[^#]*list=)[\w-]+/;

module.exports = { VIDEO_REGEX, PLAYLIST_REGEX };
