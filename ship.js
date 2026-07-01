#!/usr/bin/env node
/**
 * ship.js — deploy ครบทั้งสองเป้าหมายในคำสั่งเดียว
 * ------------------------------------------------------------
 *  1) build   : build-css.js (→ tailwindcss.html) + build-web.js (→ docs/index.html)
 *  2) backend : clasp push --force + clasp deploy (อัปเวอร์ชัน GAS Web App)
 *  3) frontend: git add/commit/push → GitHub Pages (เสิร์ฟจาก main/docs)
 *
 * ถ้าขั้นตอนใด fail จะหยุดทันที (ไม่ push ของเสียขึ้น production)
 *
 * ใช้:  npm run ship
 *       npm run ship -- "ข้อความ commit ของฉัน"
 */
const { execSync } = require('child_process');

const DEPLOYMENT_ID = 'AKfycbwUqBMch6-fVD31Ngm-9eTNzawK6oUNodUFM5VhlTZ6Fb-lg6IfWoneAWwfz3UkyW6u';

function run(cmd) {
  console.log('\n\x1b[36m$ ' + cmd + '\x1b[0m');
  execSync(cmd, { stdio: 'inherit' });
}

// ── 1. Build (CSS + docs bundle) ──
run('node build-css.js');
run('node build-web.js');

// ── 2. Backend → GAS ──
run('clasp push --force');
run('clasp deploy -i ' + DEPLOYMENT_ID + ' -d "ship"');

// ── 3. Frontend → GitHub Pages (commit เฉพาะเมื่อมีการเปลี่ยนแปลง) ──
run('git add -A');
const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
if (dirty) {
  const msg = process.argv[2] || 'chore: build + deploy (backend + pages)';
  execSync('git commit -m ' + JSON.stringify(msg), { stdio: 'inherit' });
  run('git push');
  console.log('\n\x1b[32m✅ Shipped — GAS deploy + push ขึ้น GitHub Pages เรียบร้อย\x1b[0m');
  console.log('   GitHub Pages จะ rebuild ~1-2 นาที · แล้ว hard refresh (Ctrl+F5)');
} else {
  console.log('\n\x1b[32m✅ Deploy GAS เรียบร้อย — ไม่มีไฟล์เปลี่ยน จึงไม่ต้อง push ขึ้น Pages\x1b[0m');
}
