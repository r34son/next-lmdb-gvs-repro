import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from 'lmdb-consumer';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const directory = mkdtempSync(join(tmpdir(), 'lmdb-esm-'));
  const db = open({ path: directory });
  try {
    db.putSync('probe', true);
    return <p>LMDB ESM: {String(db.get('probe'))}</p>;
  } finally {
    await db.close();
    rmSync(directory, { recursive: true });
  }
}
