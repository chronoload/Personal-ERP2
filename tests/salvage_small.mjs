// 生成小文件的恢复字符流
import fs from 'fs';
const cipher = fs.readFileSync('C:/Users/qu/Desktop/发报接收和收件站/PersonalERP_backup_20260823_2210.json');
const enc = cipher.toString('base64');
fs.writeFileSync('./tests/_recovered_small.txt', enc, 'utf8');
console.log('small recovered:', enc.length, 'chars');
console.log(enc.slice(0, 200));
