const parse = value => JSON.parse(value || '{}');

export function initializeCatalogueSelection(db) {
  db.exec('CREATE TABLE IF NOT EXISTS catalogue_selection (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL, updated_at TEXT NOT NULL)');
}

export function readCatalogueSelection(db) {
  initializeCatalogueSelection(db);
  const row = db.prepare('SELECT document,updated_at FROM catalogue_selection WHERE id=1').get();
  return row ? { ...parse(row.document), updatedAt: row.updated_at } : { mode: 'all', projectIds: [] };
}

export function setCatalogueSelection(db, input) {
  if (!input || !['all','selected'].includes(input.mode) || !Array.isArray(input.projectIds) || input.projectIds.length > 100 || input.projectIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(id)) || new Set(input.projectIds).size !== input.projectIds.length || Object.keys(input).some(key => !['mode','projectIds'].includes(key)) || input.mode === 'all' && input.projectIds.length) throw Object.assign(new Error('Select existing projects for the catalogue'), { code: 'CATALOGUE_SELECTION_INVALID' });
  initializeCatalogueSelection(db);
  for (const id of input.projectIds) {
    const project = db.prepare('SELECT document FROM projects WHERE id=?').get(id);
    if (!project || parse(project.document).demo) throw Object.assign(new Error('Catalogue selections must be existing non-demo projects'), { code: 'CATALOGUE_PROJECT_INVALID' });
  }
  const updatedAt = new Date().toISOString(), document = JSON.stringify({ mode: input.mode, projectIds: input.projectIds });
  db.prepare('INSERT INTO catalogue_selection(id,document,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,updated_at=excluded.updated_at').run(document, updatedAt);
  return { ...parse(document), updatedAt };
}

export function catalogueIncludes(selection, projectId) {
  return selection?.mode !== 'selected' || selection.projectIds.includes(projectId);
}
