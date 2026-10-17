import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(directory) { this.directory = resolve(directory); }
  async load() {
    try {
      const state = JSON.parse(await readFile(join(this.directory, 'state.json'), 'utf8'));
      if (!Array.isArray(state.notes) || !Array.isArray(state.tasks)) throw new Error('Invalid state file');
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') return { notes: [], tasks: [] };
      throw error;
    }
  }
  async save(state) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temporary, join(this.directory, 'state.json'));
  }
}
