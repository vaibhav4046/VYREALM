#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { ReleaseStore, validateRelease } from './index.js';

const [command, ...args] = process.argv.slice(2);
const options = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true]; }));
const filePath = options.file || 'data/releases.json';
const store = new ReleaseStore({ filePath });
const readJson = value => { const text = value === '-' ? readFileSync(0, 'utf8') : (existsSync(value) ? readFileSync(value, 'utf8') : value); return JSON.parse(text); };

try {
  let result;
  if (command === 'create') result = await store.create(readJson(options.package || options.json));
  else if (command === 'list') result = await store.list();
  else if (command === 'show') result = await store.get(options.id);
  else if (command === 'validate') { const release = await store.get(options.id); if (!release) throw new Error('Release not found'); validateRelease(release); result = { valid: true, id: release.id, state: release.state }; }
  else if (command === 'transition') result = await store.transition(options.id, options.state, { reason: options.reason });
  else if (command === 'begin-upload') result = await store.beginUpload(options.id, options.session);
  else throw new Error('Usage: create --package=<json>|-, list, show --id=ID, validate --id=ID, transition --id=ID --state=STATE, begin-upload --id=ID --session=URI');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error.code || 'ERROR', message: error.message, details: error.details || {} }) + '\n');
  process.exitCode = 1;
}

