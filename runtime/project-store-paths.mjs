import { mkdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// Packaged Windows hosts can redirect a file into LocalCache while realpath
// on its parent still returns Roaming. Use the existing database as the single
// store anchor, before deriving jobs/media roots or taking engine ownership.
export async function projectStorePaths(requestedDirectory) {
  const requested = resolve(requestedDirectory);
  await mkdir(requested, { recursive: true });
  let dataDir;
  try { dataDir = dirname(await realpath(join(requested, 'vyrelum.sqlite'))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    dataDir = await realpath(requested);
  }
  const mediaDir = join(dataDir, 'media'), jobsDir = join(dataDir, 'jobs');
  await mkdir(mediaDir, { recursive: true });
  await mkdir(jobsDir, { recursive: true });
  return { dataDir, jobsDir, mediaDir, databasePath: join(dataDir, 'vyrelum.sqlite') };
}
