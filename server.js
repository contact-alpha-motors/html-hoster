import express from 'express';
import multer from 'multer';
import unzipper from 'unzipper';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data/sites');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-now';
const upload = multer({ dest: '/tmp/html-hoster', limits: { fileSize: 50 * 1024 * 1024 } });
const TEXT_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.txt', '.md', '.svg']);

await fsp.mkdir(DATA_DIR, { recursive: true });
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/admin-assets', express.static(path.resolve('public')));

function safeSlug(input='') {
  return input.toLowerCase().trim().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
function projectDir(slug) { return path.join(DATA_DIR, slug); }
function inside(base, candidate) {
  const resolved = path.resolve(base, candidate);
  return resolved === base || resolved.startsWith(base + path.sep);
}
function basicAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return ask();
  try {
    const raw = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const i = raw.indexOf(':');
    const pass = i >= 0 ? raw.slice(i + 1) : '';
    const a = Buffer.from(pass);
    const b = Buffer.from(ADMIN_PASSWORD);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  } catch {}
  return ask();
  function ask() {
    res.set('WWW-Authenticate', 'Basic realm="HTML Hoster Admin"');
    return res.status(401).send('Authentication required');
  }
}

async function listProjects() {
  const entries = await fsp.readdir(DATA_DIR, { withFileTypes: true });
  const rows = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = projectDir(e.name);
    const st = await fsp.stat(dir);
    rows.push({ slug: e.name, name: e.name, updatedAt: st.mtime.toISOString() });
  }
  return rows.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function extractZip(zipPath, dest) {
  const directory = await unzipper.Open.file(zipPath);
  for (const entry of directory.files) {
    const normalized = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('../')) continue;
    const target = path.resolve(dest, normalized);
    if (!inside(dest, target)) continue;
    if (entry.type === 'Directory') {
      await fsp.mkdir(target, { recursive: true });
    } else {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await new Promise((resolve, reject) => entry.stream().pipe(fs.createWriteStream(target)).on('finish', resolve).on('error', reject));
    }
  }
}

app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', basicAuth, (req, res) => res.sendFile(path.resolve('public/index.html')));

app.get('/api/projects', basicAuth, async (req, res) => res.json(await listProjects()));

app.post('/api/projects', basicAuth, upload.single('file'), async (req, res) => {
  let slug = safeSlug(req.body.slug || req.body.name || '');
  if (!slug) return res.status(400).json({ error: 'Invalid project name/slug' });
  const dest = projectDir(slug);
  if (fs.existsSync(dest)) return res.status(409).json({ error: 'Project already exists' });
  await fsp.mkdir(dest, { recursive: true });
  try {
    if (!req.file) {
      await fsp.writeFile(path.join(dest, 'index.html'), '<!doctype html><html><body><h1>New project</h1></body></html>');
    } else if (req.file.originalname.toLowerCase().endsWith('.zip')) {
      await extractZip(req.file.path, dest);
    } else if (req.file.originalname.toLowerCase().endsWith('.html') || req.file.originalname.toLowerCase().endsWith('.htm')) {
      await fsp.copyFile(req.file.path, path.join(dest, 'index.html'));
    } else {
      throw new Error('Upload a .zip or .html file');
    }
    if (!fs.existsSync(path.join(dest, 'index.html'))) throw new Error('Project must contain index.html at its root');
    res.json({ ok: true, slug, url: `/${slug}/` });
  } catch (e) {
    await fsp.rm(dest, { recursive: true, force: true });
    res.status(400).json({ error: e.message });
  } finally {
    if (req.file) await fsp.rm(req.file.path, { force: true });
  }
});

app.post('/api/projects/:slug/replace', basicAuth, upload.single('file'), async (req, res) => {
  const slug = safeSlug(req.params.slug);
  const dest = projectDir(slug);
  if (!fs.existsSync(dest)) return res.status(404).json({ error: 'Project not found' });
  if (!req.file) return res.status(400).json({ error: 'File required' });
  const tmp = path.join(DATA_DIR, `.tmp-${slug}-${Date.now()}`);
  await fsp.mkdir(tmp, { recursive: true });
  try {
    if (req.file.originalname.toLowerCase().endsWith('.zip')) await extractZip(req.file.path, tmp);
    else if (/\.html?$/i.test(req.file.originalname)) await fsp.copyFile(req.file.path, path.join(tmp, 'index.html'));
    else throw new Error('Upload a .zip or .html file');
    if (!fs.existsSync(path.join(tmp, 'index.html'))) throw new Error('Project must contain index.html at its root');
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.rename(tmp, dest);
    res.json({ ok: true });
  } catch (e) {
    await fsp.rm(tmp, { recursive: true, force: true });
    res.status(400).json({ error: e.message });
  } finally {
    await fsp.rm(req.file.path, { force: true });
  }
});

app.delete('/api/projects/:slug', basicAuth, async (req, res) => {
  const slug = safeSlug(req.params.slug);
  await fsp.rm(projectDir(slug), { recursive: true, force: true });
  res.json({ ok: true });
});

app.get('/api/projects/:slug/files', basicAuth, async (req, res) => {
  const slug = safeSlug(req.params.slug);
  const root = projectDir(slug);
  if (!fs.existsSync(root)) return res.status(404).json({ error: 'Project not found' });
  const out = [];
  async function walk(dir, prefix='') {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const rel = path.posix.join(prefix, e.name);
      if (e.isDirectory()) await walk(path.join(dir, e.name), rel);
      else out.push(rel);
    }
  }
  await walk(root);
  res.json(out.sort());
});

app.get('/api/projects/:slug/file', basicAuth, async (req, res) => {
  const slug = safeSlug(req.params.slug);
  const root = projectDir(slug);
  const rel = String(req.query.path || 'index.html');
  const file = path.resolve(root, rel);
  if (!inside(root, file) || !fs.existsSync(file)) return res.status(404).json({ error: 'File not found' });
  if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) return res.status(400).json({ error: 'This file is not editable as text' });
  res.type('text/plain').send(await fsp.readFile(file, 'utf8'));
});

app.put('/api/projects/:slug/file', basicAuth, async (req, res) => {
  const slug = safeSlug(req.params.slug);
  const root = projectDir(slug);
  const rel = String(req.body.path || '');
  const file = path.resolve(root, rel);
  if (!inside(root, file)) return res.status(400).json({ error: 'Invalid path' });
  if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) return res.status(400).json({ error: 'This file type is not editable' });
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, String(req.body.content ?? ''), 'utf8');
  res.json({ ok: true });
});

app.use('/:slug', (req, res, next) => {
  const slug = safeSlug(req.params.slug);
  if (!slug || !fs.existsSync(projectDir(slug))) return next();
  return express.static(projectDir(slug), { index: 'index.html', fallthrough: true })(req, res, next);
});
app.use('/:slug/*splat', (req, res, next) => {
  const slug = safeSlug(req.params.slug);
  if (!slug || !fs.existsSync(projectDir(slug))) return next();
  return express.static(projectDir(slug), { index: 'index.html', fallthrough: true })(req, res, next);
});

app.listen(PORT, '0.0.0.0', () => console.log(`HTML Hoster running on :${PORT}`));
