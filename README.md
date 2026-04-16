# express-mp3-downloader-backend

API REST do serviço de download do YouTube para MP3. Construída com **Node.js 18** e **Express 4**.

---

## Arquitetura

```
express-mp3-downloader-backend/
├── index.js              # Entrada — configura Express, CORS e registra rotas
├── routes/
│   └── download.js       # Toda a lógica de jobs, SSE e download
└── package.json
```

---

## Rotas

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/video` | Inicia o download de um vídeo individual |
| `POST` | `/api/playlist` | Inicia o download de uma playlist completa |
| `GET` | `/api/progress/:jobId` | Stream SSE com eventos de progresso em tempo real |
| `GET` | `/api/file/:jobId` | Serve o arquivo gerado (`.mp3` ou `.zip`) e o remove após o envio |

---

## Sistema de Jobs

Cada requisição de download cria um **job** armazenado em memória (`Map`). O job é identificado por um UUID e tem ciclo de vida:

```
pending → (yt-dlp rodando) → done / error
```

Jobs são removidos automaticamente após **15 minutos** via `setTimeout`, com limpeza do arquivo temporário associado.

**Estrutura de um job:**

```js
{
  id: string,           // UUID
  status: 'pending' | 'done' | 'error',
  filePath: string,     // Caminho do arquivo em os.tmpdir()
  isPlaylist: boolean,  // true para .zip, false para .mp3
  clients: Response[],  // Conexões SSE abertas no momento
  lastEvent: object,    // Último evento emitido (para replay em conexões tardias)
}
```

---

## SSE (Server-Sent Events)

O endpoint `GET /api/progress/:jobId` mantém a conexão aberta e envia eventos no formato:

```
data: {"type":"progress","percent":45}\n\n
data: {"type":"progress","percent":72,"label":"3 de 10 faixas"}\n\n
data: {"type":"done","jobId":"..."}\n\n
```

ou em caso de falha:

```
data: {"type":"error","message":"Falha no download."}\n\n
```

Se o cliente conectar após o job já ter terminado, o `lastEvent` é reenviado imediatamente.

---

## Pipeline de download

### Vídeo individual (`runVideo`)

```
spawn yt-dlp
  --extract-audio
  --audio-format mp3
  --audio-quality 192K
  --no-playlist
  --ffmpeg-location <ffmpeg-static>
  --newline              ← força uma linha por evento de progresso
  → parse stdout/stderr para extrair "XX%"
  → emite { type: 'progress', percent }
  → ao fechar (exit 0): emite { type: 'done' }
```

O arquivo é salvo em `os.tmpdir()` com nome UUID para evitar colisões.

### Playlist (`runPlaylist`)

```
spawn yt-dlp
  --yes-playlist
  --output "%(playlist_index)s - %(title)s.%(ext)s"
  → parse "Downloading item X of Y" → calcula progresso geral
  → progresso geral = ((item - 1 + percent/100) / total) * 100
  → emite { type: 'progress', percent, label: "X de Y faixas" }
  → ao fechar (exit 0):
      archiver.zip(sessionDir) → emite { type: 'done' }
```

Cada faixa é salva em um diretório temporário exclusivo da sessão. Após a compactação em `.zip` com `archiver` (compressão nível 0, sem recomprimir áudio), o diretório é removido.

---

## Dependências

| Pacote | Uso |
|--------|-----|
| `express` | Servidor HTTP |
| `cors` | Libera requisições vindas de `http://localhost:5173` |
| `youtube-dl-exec` | Wrapper Node.js para o `yt-dlp.exe` (binário incluso em `bin/`) |
| `ffmpeg-static` | Fornece o `ffmpeg.exe` sem instalação global (caminho passado via `--ffmpeg-location`) |
| `archiver` | Compactação das faixas da playlist em `.zip` |
| `uuid` | Geração de IDs únicos para jobs e arquivos temporários |

---

## Nota sobre o antivírus

O binário `ffmpeg.exe` fica em:

```
node_modules/ffmpeg-static/ffmpeg.exe
```

Alguns antivírus (incluindo o Windows Defender) podem remover esse arquivo. Caso isso ocorra, adicione a pasta `node_modules/ffmpeg-static/` como exclusão e rode `npm install` novamente.

---

## Como executar

### Pré-requisitos

- Node.js 18.x

Os binários `yt-dlp.exe` e `ffmpeg.exe` são baixados automaticamente pelo `npm install` — não é necessário nenhuma instalação global.

### Instalar dependências

```bash
npm install
```

### Iniciar em modo desenvolvimento

```bash
npm run dev
```

Usa `node --watch` (nativo do Node 18). O servidor reinicia automaticamente ao salvar qualquer arquivo.

Disponível em `http://localhost:3001`.

### Iniciar em produção

```bash
npm start
```
