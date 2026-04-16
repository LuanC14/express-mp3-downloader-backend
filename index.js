const express = require('express');
const cors = require('cors');
const downloadRouter = require('./routes/download');

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Respond to preflight immediately before any other middleware
app.options('*', cors({ origin: FRONTEND_URL, optionsSuccessStatus: 204 }));
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api', downloadRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
