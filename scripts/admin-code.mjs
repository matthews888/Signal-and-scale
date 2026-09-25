import { randomInt, randomBytes, scryptSync } from 'node:crypto';
const code=String(randomInt(0,1000000)).padStart(6,'0'),salt=randomBytes(16).toString('hex');
console.log('Reusable admin code:',code);
console.log('ADMIN_CODE_HASH='+salt+':'+scryptSync(code,salt,32).toString('hex'));
console.log('Keep the code private. Set only ADMIN_CODE_HASH in Vercel; never commit either value.');
