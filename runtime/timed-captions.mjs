/** Keep every word while splitting long captions into readable timed pages. */
export function prepareTimedCaptions(segments, duration) {
  if (!Array.isArray(segments) || segments.length > 3000) throw new Error('Invalid caption list');
  let previousEnd = 0;
  return segments.flatMap((segment, index) => {
    const start = Number(segment.start), end = Number(segment.end);
    const text = String(segment.text || '').replace(/\s+/g, ' ').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd - 0.001 || end <= start || end > duration + 0.05 || !text || text.length > 2000) throw new Error(`Caption ${index + 1} has invalid text or timing`);
    previousEnd = end;
    const lines = []; let line = '';
    for (const word of text.split(' ')) {
      if (word.length > 42) throw new Error(`Caption ${index + 1} contains a word too long for safe display`);
      if (line && line.length + word.length + 1 > 42) { lines.push(line); line = ''; }
      line += (line ? ' ' : '') + word;
    }
    if (line) lines.push(line);
    const pages = []; for (let i = 0; i < lines.length; i += 2) pages.push(lines.slice(i, i + 2).join('\n'));
    return pages.map((page, i) => ({start: start + (end - start) * i / pages.length, end: start + (end - start) * (i + 1) / pages.length, text: page}));
  });
}
