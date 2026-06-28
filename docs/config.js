/* ============================================================
   config.js — ตั้งค่าการเชื่อมต่อ GAS REST API
   ============================================================
   แก้ LTC_API_URL ให้เป็น URL ของ Web App deployment (/exec)
   ดูได้ที่ Apps Script → Deploy → Manage deployments → Web app URL
*/
window.LTC_API_URL = 'PASTE_YOUR_GAS_WEBAPP_EXEC_URL_HERE';

/* (ทางเลือก) ถ้าตั้ง Setting REST_API_KEY ไว้ฝั่ง backend ให้ใส่ค่าตรงกันที่นี่
   — endpoint สาธารณะจะต้องใช้ key นี้. ถ้าไม่ตั้งให้ลบบรรทัดล่างหรือปล่อยว่าง */
// window.LTC_API_KEY = '';
