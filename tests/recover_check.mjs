// 验证：乱码 = base64_decode(JSON合法字符流)？→ 对乱码做 base64 编码应还原可读文本
import fs from 'fs';
const cipher = fs.readFileSync('C:/Users/qu/Desktop/发报接收和收件站/PersonalERP_backup_20260823_2210.json');
const enc = cipher.toString('base64');
console.log('== encode 后前 300 字符 ==\n' + enc.slice(0, 300));
console.log('\n== 中段采样 ==\n' + enc.slice(Math.floor(enc.length / 2), Math.floor(enc.length / 2) + 200));
fs.writeFileSync('C:/Users/qu/Desktop/物理科学与技术论题/TS2/personal-erp/tests/_recovered_raw.txt', enc, 'utf8');
console.log('\n已写出 tests/_recovered_raw.txt（' + enc.length + ' 字符）');
