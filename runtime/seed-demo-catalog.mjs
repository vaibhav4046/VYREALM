import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = process.env.VYRELUM_ROOT || process.cwd();
const dataDir = process.env.VYRELUM_DATA_DIR || join(root, 'data');
const mediaDir = join(dataDir, 'media');
await mkdir(mediaDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'vyrelum.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS project_revisions (project_id TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id, revision)); CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT, document TEXT NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL);');
const now = new Date().toISOString();
for (let i = 1; i <= 100; i++) {
  const id = `emberforge-demo-${String(i).padStart(3, '0')}`;
  if (db.prepare('SELECT 1 FROM projects WHERE id=?').get(id)) continue;
  const hue = (i * 37) % 360, title = ['Ashfall', 'Night Circuit', 'Tideglass', 'Orbit House', 'Signal Bloom'][i % 5];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0b0b10"/><stop offset="1" stop-color="hsl(${hue} 80% 48%)"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><circle cx="500" cy="100" r="86" fill="none" stroke="#ff7a18" stroke-width="3" opacity=".8"/><path d="M0 300 Q160 210 320 280 T640 230 V360 H0Z" fill="#050509" opacity=".72"/><text x="32" y="320" fill="#fff" font-family="Arial" font-size="24" font-weight="700">${title.toUpperCase()}</text><text x="32" y="342" fill="#ffb16b" font-family="Arial" font-size="12">VYREALM DEMO ${String(i).padStart(3, '0')}</text></svg>`;
  const aid = randomUUID(), file = join(mediaDir, `${aid}-thumbnail.svg`); await writeFile(file, svg, 'utf8');
  const asset = { name: `${title} thumbnail`, mime: 'image/svg+xml', size: Buffer.byteLength(svg), kind: 'image', demo: true };
  db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run(aid, id, JSON.stringify(asset), file, now);
  const doc = { name: `${title} ${String(i).padStart(3, '0')}`, brief: `Demo production ${i}: ${title.toLowerCase()} in an original fictional world.`, demo: true, catalog: 'VYREALM', thumbnailAssetId: aid, timeline: [], scene: { objects: [], lights: [], camera: {} }, settings: { width: 1920, height: 1080, fps: 24 }, latestOutput: null };
  db.prepare('INSERT INTO projects VALUES (?,?,?,?,?)').run(id, 1, JSON.stringify(doc), now, now);
  db.prepare('INSERT INTO project_revisions VALUES (?,?,?,?)').run(id, 1, JSON.stringify(doc), now);
}
console.log(JSON.stringify({ seeded: 100, dataDir: resolve(dataDir) }));
