#!/usr/bin/env node
/**
 * build-web.js — สร้าง static frontend สำหรับ GitHub Pages
 * ------------------------------------------------------------
 * อ่าน index.html (GAS template) → แทนที่ <?!= include('x') ?> ด้วยเนื้อไฟล์ x.html
 * → ฉีด <script src="config.js"> (ตั้ง window.LTC_API_URL) → เขียนออก docs/index.html
 *
 * วิธีใช้:  node build-web.js
 * จากนั้น:  แก้ docs/config.js ใส่ URL ของ GAS Web App (/exec) แล้ว push ขึ้น GitHub
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'docs');

function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

// ── 1. อ่าน shell แล้วแทนที่ include ทั้งหมด ──
let html = read('index.html');

// แทนที่ทุก <?!= include('name') ?> ด้วยเนื้อไฟล์ name.html
html = html.replace(/<\?!?=?\s*include\(\s*'([^']+)'\s*\)\s*\?>/g, (m, name) => {
  const file = name + '.html';
  if (!fs.existsSync(path.join(ROOT, file))) {
    console.warn('⚠️  ไม่พบ partial: ' + file + ' (ข้าม)');
    return '<!-- missing include: ' + file + ' -->';
  }
  console.log('  + inline ' + file);
  return read(file);
});

// ── 2. ฉีด config.js หลัง <body> (ให้ window.LTC_API_URL ถูกตั้งก่อน Alpine init/rpc) ──
const configTag = '\n  <!-- ตั้งค่า URL ของ GAS REST API (แก้ที่ docs/config.js) -->\n  <script src="config.js"></script>';
html = html.replace(/(<body[^>]*>)/, '$1' + configTag);

// ── 3. เขียนผลลัพธ์ ──
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html, 'utf8');

// ── 4. config.js (ไม่ทับของเดิมถ้ามีแล้ว — กันลบ URL ที่ user ตั้งไว้) ──
const cfgPath = path.join(OUT_DIR, 'config.js');
if (!fs.existsSync(cfgPath)) {
  fs.writeFileSync(cfgPath,
`/* ============================================================
   config.js — ตั้งค่าการเชื่อมต่อ GAS REST API
   ============================================================
   แก้ LTC_API_URL ให้เป็น URL ของ Web App deployment (/exec)
   ดูได้ที่ Apps Script → Deploy → Manage deployments → Web app URL
*/
window.LTC_API_URL = 'PASTE_YOUR_GAS_WEBAPP_EXEC_URL_HERE';

/* (ทางเลือก) ถ้าตั้ง Setting REST_API_KEY ไว้ฝั่ง backend ให้ใส่ค่าตรงกันที่นี่
   — endpoint สาธารณะจะต้องใช้ key นี้. ถ้าไม่ตั้งให้ลบบรรทัดล่างหรือปล่อยว่าง */
// window.LTC_API_KEY = '';
`, 'utf8');
  console.log('  + docs/config.js (template — อย่าลืมใส่ URL)');
} else {
  console.log('  = docs/config.js มีอยู่แล้ว (คงค่าเดิมไว้)');
}

// ── 5. .nojekyll กัน GitHub Pages ประมวลผลด้วย Jekyll ──
fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '', 'utf8');

console.log('\n✅ Build เสร็จ → docs/index.html');
console.log('   ถัดไป: แก้ docs/config.js ใส่ URL แล้ว push + เปิด GitHub Pages (Source: /docs)');
