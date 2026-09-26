import 'dotenv/config'; import fs from 'node:fs'; import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
for(let i=0;i<30;i++){try{await pool.query(fs.readFileSync('db/schema.sql','utf8')); console.log('Database pronto'); await pool.end(); process.exit(0)}catch(e){if(i===29)throw e; await new Promise(r=>setTimeout(r,2000));}}
