import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import xlsx from 'xlsx';
import mammoth from 'mammoth';
import archiver from 'archiver';
import crypto from 'crypto';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import cors from 'cors';

const app = express();
const port = process.env.PORT || 3001;

// Render needs CORS configured for the frontend domain
const allowedOrigins = [
  'http://localhost:5173',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Health check for Render
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Namster API' });
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');
const workDir = path.join(__dirname, 'work');

for (const d of [publicDir, uploadsDir, workDir]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

app.use(express.static(publicDir));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + file.originalname.replace(/\s+/g, '_'));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// In-memory session store
const sessions = new Map();

function newSession() {
  const id = crypto.randomUUID();
  sessions.set(id, {
    id,
    createdAt: Date.now(),
    modelPath: null,
    listPath: null,
    names: [],
    cleanup: [],
  });
  return id;
}

function cleanupSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  for (const p of s.cleanup) {
    try {
      if (p && fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    } catch { }
  }
  sessions.delete(id);
}

function parseNamesFromText(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  return lines.map(line => {
    // Split by '=' to separate name and table
    const parts = line.split('=');
    if (parts.length >= 2) {
      return {
        name: parts[0].trim(),
        table: parts.slice(1).join('=').trim()
      };
    }
    // Fallback to ':' or tab if '=' is not present
    const altParts = line.split(/[:\t]/);
    if (altParts.length >= 2) {
      return {
        name: altParts[0].trim(),
        table: altParts[1].trim()
      };
    }
    return { name: line.trim(), table: '' };
  }).filter(item => {
    const norm = item.name.toLowerCase().replace(/\s+/g, '');
    return norm !== 'liste' && norm !== '';
  });
}

async function extractNamesFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv') {
    const content = fs.readFileSync(filePath, 'utf8');
    return parseNamesFromText(content);
  }

  if (ext === '.xlsx' || ext === '.xls') {
    const wb = xlsx.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 });
    return data.map(row => {
      let name = String(row[0] || '').trim();
      let table = String(row[1] || '').trim();

      // If second column is empty, try to parse Name = Table from the first one
      if (!table && name.includes('=')) {
        const parts = name.split('=');
        name = parts[0].trim();
        table = parts[1].trim();
      } else if (!table && name.includes(':')) {
        const parts = name.split(':');
        name = parts[0].trim();
        table = parts[1].trim();
      }

      return { name, table };
    }).filter(row => row.name);
  }

  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ path: filePath });
    return parseNamesFromText(value || '');
  }

  if (ext === '.pdf') {
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const { default: pdfParse } = await import('pdf-parse');
      const data = await pdfParse(dataBuffer);
      return parseNamesFromText(data.text || '');
    } catch (e) {
      console.warn('PDF parsing failed:', e?.message);
      return [];
    }
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return parseNamesFromText(content);
  } catch {
    return [];
  }
}

function buildSVGOverlay(elements, width, height) {
  const safeStr = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const textItems = elements.map(el => {
    const ff = el.fontFamily || 'Arial';
    const fsPx = Number(el.fontSize) || 48;
    const fill = el.color || '#000000';
    return `<text x="${el.x}" y="${el.y}" style="font-family: '${ff}'; font-size: ${fsPx}px; fill: ${fill}; dominant-baseline: hanging;">${safeStr(el.text)}</text>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${textItems}
</svg>`;
}

async function composeImageWithElements(modelPath, outPath, elements) {
  let modelBuffer = fs.readFileSync(modelPath);
  const ext = path.extname(modelPath).toLowerCase();

  // Basic PDF handling (placeholder for real rendering)
  if (ext === '.pdf') {
    console.log("PDF Model detected - Sharp doesn't support rendering PDF directly without system deps.");
    // In a production env, we'd use something like pdf-to-img.
    // For this demo, we'll try to process if it's actually an image renamed or just fail gracefully.
  }

  const img = sharp(modelBuffer);
  const meta = await img.metadata();
  const width = meta.width || 2000;
  const height = meta.height || 1000;

  const svg = buildSVGOverlay(elements, width, height);
  const buffer = await img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
  await fs.promises.writeFile(outPath, buffer);
}

app.post('/api/upload', upload.fields([
  { name: 'model', maxCount: 1 },
  { name: 'list', maxCount: 1 },
]), async (req, res) => {
  try {
    const sid = newSession();
    const s = sessions.get(sid);
    const model = req.files['model']?.[0];
    const list = req.files['list']?.[0];

    if (!model || !list) {
      return res.status(400).json({ error: 'Model image and list file are required.' });
    }

    s.modelPath = model.path;
    s.listPath = list.path;
    s.cleanup.push(model.path, list.path);

    const names = await extractNamesFromFile(s.listPath);
    s.names = names;

    res.json({ sessionId: sid, namesTotal: names.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed.' });
  }
});

app.post('/api/test', express.json(), async (req, res) => {
  try {
    const { sessionId, x, y, tx, ty, useTable, fontFamily, fontSize, color } = req.body || {};
    const s = sessions.get(sessionId);
    if (!s) return res.status(400).json({ error: 'Invalid session' });

    const firstEntry = s.names[0] || { name: 'INVITE TEST', table: '01' };
    const elements = [{ text: firstEntry.name, x, y, fontFamily, fontSize, color }];

    if (useTable && tx !== null && ty !== null) {
      elements.push({ text: firstEntry.table || '01', x: tx, y: ty, fontFamily, fontSize, color });
    }

    const outDir = path.join(workDir, sessionId);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'test.png');

    await composeImageWithElements(s.modelPath, outPath, elements);
    s.cleanup.push(outDir);

    const data = fs.readFileSync(outPath);
    res.json({ preview: 'data:image/png;base64,' + data.toString('base64') });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Test render failed.' });
  }
});

app.post('/api/generate', express.json(), async (req, res) => {
  try {
    const { sessionId, x, y, tx, ty, useTable, fontFamily, fontSize, color, offset, limit } = req.body || {};
    const s = sessions.get(sessionId);
    if (!s) return res.status(400).json({ error: 'Invalid session' });

    const outDir = path.join(workDir, sessionId, 'all');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const start = Math.max(0, Number(offset) || 0);
    const batchSize = Math.min(50, Number(limit) || 50);
    const endExclusive = Math.min(s.names.length, start + batchSize);

    for (let idx = start; idx < endExclusive; idx++) {
      const entry = s.names[idx];
      const filename = `${String(idx + 1).padStart(3, '0')}-${entry.name.replace(/[^a-z0-9_-]+/gi, '_')}.png`;
      const outPath = path.join(outDir, filename);

      const elements = [{ text: entry.name, x, y, fontFamily, fontSize, color }];
      if (useTable && tx !== null && ty !== null) {
        elements.push({ text: entry.table, x: tx, y: ty, fontFamily, fontSize, color });
      }

      await composeImageWithElements(s.modelPath, outPath, elements);
    }

    const zipPath = path.join(workDir, sessionId, 'invitations.zip');
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(outDir, false);
      archive.finalize();
    });
    s.cleanup.push(path.join(workDir, sessionId));

    res.json({ downloadUrl: `/api/download/${sessionId}`, processed: endExclusive - start, total: s.names.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Generation failed.' });
  }
});

app.get('/api/download/:sid', (req, res) => {
  const sid = req.params.sid;
  const s = sessions.get(sid);
  if (!s) return res.status(400).json({ error: 'Invalid session' });
  const zipPath = path.join(workDir, sid, 'invitations.zip');
  if (!fs.existsSync(zipPath)) return res.status(404).json({ error: 'ZIP not found' });
  res.download(zipPath, 'invitations.zip', (err) => {
    cleanupSession(sid);
  });
});

app.listen(port, () => {
  console.log(`Namster Premium server running at http://localhost:${port}`);
});
