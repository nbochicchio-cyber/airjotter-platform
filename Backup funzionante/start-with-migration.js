import fs from 'node:fs';
import pg from 'pg';

async function migrateAndStart() {
  const schemaPath = new URL('./db/schema.sql', import.meta.url);
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const database = new pg.Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await database.connect();
    await database.query(sql);
    console.log('MIGRAZIONE AIRJOTTER COMPLETATA');
  } finally {
    await database.end();
  }

  await import('./src/server.js');
}

migrateAndStart().catch((error) => {
  console.error('MIGRAZIONE AIRJOTTER NON RIUSCITA:', error);
  process.exit(1);
});
