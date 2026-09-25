import pg from 'pg';
import { readFile } from 'node:fs/promises';
const connectionString=process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if(!connectionString)throw new Error('Set DATABASE_URL_UNPOOLED before running migrations.');
const client=new pg.Client({connectionString});
await client.connect();
try{await client.query('BEGIN');await client.query(await readFile(new URL('../db/0001_careers.sql',import.meta.url),'utf8'));await client.query('COMMIT');console.log('Careers tables are ready.');}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
