// 验证：备份乱码是否符合「字符串被当 base64 解码」假设（验证后删除）
import fs from 'fs';
const cipher = fs.readFileSync('C:/Users/qu/Desktop/发报接收和收件站/PersonalERP_backup_20260823_2210.json');

console.log('cipher head:', cipher.slice(0, 32).toString('hex'));

// 原文开头（serialize 用 JSON.stringify(obj,null,2)）
const plain = Buffer.from('{\n  "app": "personal-erp",\n  "version": 1,\n  "exportedAt":', 'utf8');
console.log('plain  head:', plain.slice(0, 32).toString('hex'));

// 假设 A：原文被跳过非 base64 字符后按 base64 解码
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const kept = [];
for (const ch of plain.toString('latin1')) if (B64.includes(ch)) kept.push(ch);
console.log('kept b64 chars:', kept.join('').slice(0, 24));
const decoded = Buffer.from(kept.slice(0, Math.floor(kept.length / 4) * 4).join(''), 'base64');
console.log('A 解码头:', decoded.slice(0, 16).toString('hex'), '匹配:', decoded.slice(0, 4).equals(cipher.slice(0, 4)));

// 假设 B：逐字节 XOR 常量 key
for (let k = 1; k < 256; k++) {
  if ((plain[0] ^ k) === cipher[0] && (plain[1] ^ k) === cipher[1] && (plain[2] ^ k) === cipher[2]) {
    console.log('B 恒定 XOR key=0x' + k.toString(16));
    break;
  }
}

// 假设 C：UTF-8 文本被按 UTF-16LE 重写（每字节后补 00）→ 排除用（密文无 00 特征）
let zeros = 0;
for (const b of cipher.slice(0, 256)) if (b === 0) zeros++;
console.log('C 密文前256字节中 0x00 数量:', zeros, '(UTF-16 特征应≈128)');

// 假设 D：gzip/zlib 压缩
console.log('D gzip magic(1F8B):', cipher[0] === 0x1f && cipher[1] === 0x8b, ' zlib magic(789C):', cipher[0] === 0x78 && cipher[1] === 0x9c);

// 尾部检查：JSON 正常结尾应为 }
const tail = cipher.slice(-16);
console.log('cipher tail:', tail.toString('hex'));
