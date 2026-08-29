// 调试 resources 循环为何早退
import fs from 'fs';
const t = fs.readFileSync('./tests/_recovered_big.txt', 'utf8');
let i = t.indexOf('version');
const eat = (s) => { if (t.startsWith(s, i)) { i += s.length; return true; } return false; };
eat('version'); eat('exportedAt');
// 手动跳过 exportedAt 数字
i = t.indexOf('Z', i) + 1;
console.log('after Z:', JSON.stringify(t.slice(i, i + 40)));
eat('db');
eat('resources');
for (let n = 0; n < 8; n++) {
  const start = i;
  const hasName = eat('name');
  console.log(`#${n} eat(name)=${hasName} next=[${JSON.stringify(t.slice(i, i + 60))}]`);
  if (!hasName) break;
  // 找 id
  const idPos = t.indexOf('id', i);
  // 快速跳到这个资源的末尾：找下一个 'name' 或 'rules'
  const nextName = t.indexOf('name', i);
  const rulesP = t.indexOf('rules', i);
  console.log(`   nextName@${nextName} rules@${rulesP}`);
  i = (rulesP !== -1 && (nextName === -1 || rulesP < nextName)) ? rulesP : nextName;
}
