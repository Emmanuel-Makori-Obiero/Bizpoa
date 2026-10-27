import fs from 'node:fs/promises';
import path from 'node:path';

const emptyDatabase = () => ({ users: {}, sessions: {}, transactions: [], businesses: {}, smsNotes: [] });

export function createStore(filePath) {
  let queue = Promise.resolve();

  async function load() {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      return {
        users: parsed.users ?? {},
        sessions: parsed.sessions ?? {},
        transactions: parsed.transactions ?? [],
        businesses: parsed.businesses ?? {},
        smsNotes: parsed.smsNotes ?? [],
      };
    } catch (error) {
      if (error.code === 'ENOENT') return emptyDatabase();
      throw error;
    }
  }

  async function save(database) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  }

  return {
    read(operation) {
      const result = queue.then(async () => operation(await load()));
      queue = result.catch(() => {});
      return result;
    },
    transact(operation) {
      const result = queue.then(async () => {
        const database = await load();
        const value = await operation(database);
        await save(database);
        return value;
      });
      queue = result.catch(() => {});
      return result;
    },
  };
}
