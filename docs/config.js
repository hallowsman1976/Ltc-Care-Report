/* ============================================================
   config.js — ตั้งค่าการเชื่อมต่อ GAS REST API
   ============================================================
   แก้ LTC_API_URL ให้เป็น URL ของ Web App deployment (/exec)
   ดูได้ที่ Apps Script → Deploy → Manage deployments → Web app URL
*/
window.LTC_API_URL = 'https://script.google.com/macros/s/AKfycbwUqBMch6-fVD31Ngm-9eTNzawK6oUNodUFM5VhlTZ6Fb-lg6IfWoneAWwfz3UkyW6u/exec';

/* (ทางเลือก) ถ้าตั้ง Setting REST_API_KEY ไว้ฝั่ง backend ให้ใส่ค่าตรงกันที่นี่
   — endpoint สาธารณะจะต้องใช้ key นี้. ถ้าไม่ตั้งให้ลบบรรทัดล่างหรือปล่อยว่าง */
// window.LTC_API_KEY = '';
