import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { catalogueIncludes, readCatalogueSelection, setCatalogueSelection } from './catalogue-selection.mjs';

function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,document TEXT); CREATE TABLE jobs(id TEXT); CREATE TABLE assets(id TEXT);');
  for (const [id,document] of [['epic',{}],['rain',{}],['demo',{demo:true}]]) db.prepare('INSERT INTO projects VALUES(?,?)').run(id,JSON.stringify(document));
  db.prepare('INSERT INTO jobs VALUES(?)').run('retained'); db.prepare('INSERT INTO assets VALUES(?)').run('retained');
  return db;
}

test('curation changes visibility, preserves every project, asset and job, and survives reread', t => {
  const db = fixture(t); assert.equal(readCatalogueSelection(db).mode, 'all');
  setCatalogueSelection(db,{mode:'selected',projectIds:['epic']});
  const saved = readCatalogueSelection(db);
  assert.equal(catalogueIncludes(saved,'epic'),true); assert.equal(catalogueIncludes(saved,'rain'),false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n,3);
  assert.equal(db.prepare('SELECT count(*) AS n FROM assets').get().n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM jobs').get().n,1);
  setCatalogueSelection(db,{mode:'all',projectIds:[]}); assert.equal(catalogueIncludes(readCatalogueSelection(db),'rain'),true);
});

test('invalid, foreign and demo selections are rejected without changing saved selection', t => {
  const db = fixture(t); setCatalogueSelection(db,{mode:'selected',projectIds:['epic']});
  for (const request of [{mode:'selected',projectIds:['missing']},{mode:'selected',projectIds:['demo']},{mode:'selected',projectIds:['epic','epic']},{mode:'all',projectIds:['epic']},{mode:'selected',projectIds:['../epic']},{mode:'selected',projectIds:['epic'],completed:true}]) assert.throws(()=>setCatalogueSelection(db,request));
  assert.deepEqual(readCatalogueSelection(db).projectIds,['epic']);
});
