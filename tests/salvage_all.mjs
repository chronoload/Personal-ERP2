// 抢救：对损坏备份做 base64 编码还原字符流（大文件优先）
import fs from 'fs';
const files = [
  'C:/Users/qu/Desktop/发报接收和收件站/PersonalERP_backup_20260823.json',
  'C:/Users/qu/Desktop/发报接收和收件站/PersonalERP_backup_20260823_2210.json',
];
for (const f of files) {
  if (!fs.existsSync(f)) { console.log('跳过不存在:', f); continue; }
  const cipher = fs.readFileSync(f);
  const enc = cipher.toString('base64');
  const out = f.replace(/\.json$/, '') + '_recovered.txt';
  fs.writeFileSync(out, enc, 'utf8');
  console.log(`\n== ${f.split('/').pop()} ==`);
  console.log(`cipher ${cipher.length}B → recovered ${enc.length} chars → ${out}`);
  console.log('head :', enc.slice(0, 160));
  console.log('mid  :', enc.slice(Math.floor(enc.length * 0.5), Math.floor(enc.length * 0.5) + 120));
}
