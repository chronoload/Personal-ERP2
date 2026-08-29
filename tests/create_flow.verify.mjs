// 临时复现：全新空库 → 初始化引导 → 创建活动 全链路（验证后删除）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  const { existsSync, readdirSync } = require('fs');
  const { join } = require('path');
  const npxDir = join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  let found = '';
  for (const d of readdirSync(npxDir)) { const p = join(npxDir, d, 'node_modules', 'playwright'); if (existsSync(p)) { found = p; break; } }
  ({ chromium } = require(found));
}

const errors = [];
let failed = false;
const ok = (cond, name) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) failed = true; };

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 空库状态：应显示初始化引导
  ok(await page.evaluate(() => document.getElementById('content').innerHTML.includes('setup') || document.body.innerHTML.includes('资源')), '空库进入引导页');
  // 通过引擎造首个资源（等价于引导完成），走真实 render 分支
  await page.evaluate(() => {
    App.db.resources.push({ id: 'r1', name: '时间', unit: '分', initial: 600, color: '#5b8def', status: 'Active' });
    App.render(true);
  });
  await page.waitForTimeout(400);

  // UI 完整流程建活动（与用户操作一致）
  await page.evaluate(() => App.overview.openActModal());
  await page.waitForTimeout(300);
  await page.fill('#f-aname', '测试活动');
  await page.click('[data-save]');
  await page.waitForTimeout(500);

  const st = await page.evaluate(() => ({
    count: App.db.activities.length,
    title: App.db.activities[0] && App.db.activities[0].title,
    saved: !!localStorage.getItem('personal_erp_db_v1'),
    savedActs: (() => { try { return JSON.parse(localStorage.getItem('personal_erp_db_v1')).activities.length; } catch (e) { return -1; } })(),
  }));
  ok(st.count === 1 && st.title === '测试活动', `活动已入库（${st.count} 条：${st.title}）`);
  ok(st.savedActs >= 1, `持久化落盘（localStorage 中 ${st.savedActs} 条）`);

  // 循环 10 次随机建，排除偶发
  let allOk = true;
  for (let i = 0; i < 10; i++) {
    await page.evaluate((n) => App.overview.openActModal(), i);
    await page.waitForTimeout(150);
    await page.fill('#f-aname', '批量' + i);
    await page.click('[data-save]');
    await page.waitForTimeout(250);
  }
  allOk = await page.evaluate(() => App.db.activities.filter((a) => String(a.title).startsWith('批量')).length === 10);
  ok(allOk, '连续创建 10 个全部成功');

  ok(errors.length === 0, '全程零报错 ' + JSON.stringify(errors));
} finally {
  await browser.close();
}
console.log(failed ? '\n== 存在失败项 ==' : '\n== 全部通过 ==');
process.exit(failed ? 1 : 0);
