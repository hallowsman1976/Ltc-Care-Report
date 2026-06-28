# 📘 คู่มือติดตั้งและใช้งานระบบ LTC Care Report
## ระบบรายงานการดูแลผู้สูงอายุและผู้ที่มีภาวะพึ่งพิง (NHSO LTC Benefit Package)

> เวอร์ชัน 2.0 · ปรับปรุง Phase 8 (Security + Integration + Deploy)
> Backend: Google Apps Script · Database: Google Sheets · Frontend: HTML + Tailwind + Alpine.js

---

# สารบัญ
1. [ภาพรวมระบบ](#1-ภาพรวมระบบ)
2. [รายการไฟล์ทั้งหมด](#2-รายการไฟล์ทั้งหมด)
3. [สรุปฟังก์ชันทั้งหมด](#3-สรุปฟังก์ชันทั้งหมด)
4. [Security Checklist](#4-security-checklist)
5. [คู่มือติดตั้ง (Deploy Guide) 13 ขั้นตอน](#5-คู่มือติดตั้ง-deploy-guide)
6. [Checklist ก่อนใช้งานจริง](#6-checklist-ก่อนใช้งานจริง)
7. [คู่มือผู้ดูแลระบบ (Admin)](#7-คู่มือผู้ดูแลระบบ-admin)
8. [คู่มือผู้ดูแล (Caregiver) ฉบับย่อ](#8-คู่มือผู้ดูแล-caregiver-ฉบับย่อ)

---

# 1. ภาพรวมระบบ

ระบบเว็บแอปพลิเคชันสำหรับบันทึก ติดตาม และรายงานการดูแลผู้สูงอายุ/ผู้พึ่งพิงในระดับตำบล
ทำงานบน Google Apps Script (ฟรี ไม่มีค่า server) เก็บข้อมูลใน Google Sheets

**ฟังก์ชันหลัก 7 ด้าน**
- 📊 Dashboard สรุปสถานการณ์ภาพรวม
- 👥 ทะเบียนผู้รับบริการ + Timeline
- 🚪 บันทึกการเยี่ยมบ้าน (auto VisitNo)
- 📋 แบบประเมิน 5 ขั้น (Vital/ADL/PPS/Mental/Benefit)
- 🗺️ แผนที่เคสตามสถานะสี
- 📈 รายงาน + Export CSV/พิมพ์
- 🔔 แจ้งเตือน LINE + ตั้งค่าระบบ

**บทบาทผู้ใช้ (Role) 4 ระดับ:** admin > cm (Care Manager) > cg (Caregiver) > viewer

---

# 2. รายการไฟล์ทั้งหมด

## Backend (Google Apps Script — 13 ไฟล์ .gs)

| ไฟล์ | บทบาท |
|------|-------|
| `Code.gs` | Entry point `doGet`, schema 13 sheet, `setupSheets`, เมนู, permission matrix |
| `SheetService.gs` | CRUD (`appendData`/`updateData`/`findData`), generateId, formatDateThai, maskCID, validateCID |
| `Auth.gs` | Login/Logout, session (CacheService), checkPermission, writeAuditLog, getCaregivers |
| `Api.gs` | RPC พื้นฐาน: ping, setup, getAppConfig, changePassword, getAuditLog |
| `CaseService.gs` | ผู้ป่วย CRUD + search + timeline + **getDashboardData** |
| `CarePlanService.gs` | แผนการดูแล CRUD + approve |
| `VisitService.gs` | การเยี่ยม + **VisitNo auto (LockService)** + overdue/upcoming |
| `AssessmentService.gs` | Vital/ADL/PPS/MentalHealth (คำนวณ+แปลผล) |
| `BenefitService.gs` | รายงานบริการ 15 รายการ (upsert รายเดือน) |
| `MapService.gs` | `getMapCases` + สถานะสี |
| `UploadService.gs` | อัปโหลด/ลบรูป Google Drive + PDPA |
| `ReportService.gs` | analytics, individual/monthly report, export 7 ประเภท |
| `MessagingService.gs` | LINE Messaging API, แจ้งเตือน 5 แบบ, settings CRUD |

## Frontend (HTML — 11 ไฟล์)

| ไฟล์ | บทบาท |
|------|-------|
| `index.html` | โครงหลัก SPA + Login + Sidebar/Bottom Nav + รวมทุกหน้า |
| `style.html` | CSS ทั้งระบบ (card, button, skeleton, print, photo) |
| `script.html` | Alpine.js app, `rpc()` wrapper, navItems, error logging |
| `dashboard.html` | หน้า Dashboard (8 การ์ด + 4 กราฟ + filter) |
| `case-form.html` | ทะเบียนผู้ป่วย + modal เพิ่ม/แก้ + timeline + PDPA |
| `visit-form.html` | ฟอร์มเยี่ยมบ้าน + แนบรูป + PDPA |
| `assessment-form.html` | Stepper 5 ขั้น |
| `map.html` | แผนที่ Leaflet |
| `report.html` | รายงาน + export |
| `setting.html` | ตั้งค่า (admin) + แจ้งเตือน |
| `appsscript.json` | config + OAuth scopes |

## เอกสาร
| ไฟล์ | บทบาท |
|------|-------|
| `DESIGN.md` | เอกสารออกแบบระบบ (Phase 1) |
| `DEPLOY_GUIDE.md` | คู่มือนี้ |
| `CAREGIVER_GUIDE.md` | คู่มือผู้ดูแลฉบับย่อ |

---

# 3. สรุปฟังก์ชันทั้งหมด

## 🔐 Auth & User (Auth.gs / Api.gs)
- `api_login(username, password)` · `api_logout(token)` · `api_getCurrentUser(token)`
- `api_changePassword(token, old, new)` · `api_getCaregivers(token)`
- `api_getAppConfig()` (ไม่ต้อง login) · `api_getAuditLog(token, limit)` (admin)
- `checkPermission(role, module, action)` · `writeAuditLog(...)`

## 👥 Patient (CaseService.gs)
- `api_getPatients(token, filters)` · `api_getPatientById(token, id)`
- `api_savePatient(token, data)` · `api_updatePatient(token, id, data)` · `api_deletePatient(token, id)` (soft)
- `api_searchPatients(token, keyword)` · `api_getPatientTimeline(token, id)`
- `api_getDashboardData(token, filters)`

## 📋 Care Plan (CarePlanService.gs)
- `api_saveCarePlan` · `api_updateCarePlan` · `api_approveCarePlan`
- `api_getCarePlanByPatient` · `api_getActiveCarePlan`

## 🚪 Visit (VisitService.gs)
- `api_saveVisit` · `api_updateVisit` · `api_getVisitsByPatient` · `api_getVisitById`
- `api_calculateVisitNo` · `api_getOverdueVisits` · `api_getUpcomingVisits`

## 🩺 Assessment (AssessmentService.gs)
- Vital: `api_saveVitalSigns` · `api_getVitalSignsByPatient` · `api_calculateBMI/interpretBMI/interpretBP/interpretDTX`
- ADL: `api_saveADL` · `api_getADLByPatient` · `api_interpretADL` · `api_classifyTAI`
- PPS: `api_savePPS` · `api_getPPSByPatient` · `api_interpretPPS`
- Mental: `api_saveMentalHealth` · `api_getMentalHealthByPatient` · `api_detectHighRisk`
- `api_getAssessmentMeta`

## ✅ Benefit (BenefitService.gs)
- `api_getBenefitItems` · `api_saveBenefitReport` (upsert) · `api_getBenefitReportsByPatient`

## 🗺️ Map (MapService.gs)
- `api_getMapCases(token, filters)`

## 📷 Photo (UploadService.gs)
- `api_uploadPhoto(token, base64, filename, patientId, visitId, caption, consent)`
- `api_getPhotosByVisit` · `api_getPhotosByPatient` · `api_deletePhoto`

## 📈 Report (ReportService.gs)
- `api_getAnalytics` · `api_getIndividualReport` · `api_getMonthlyReport`
- `api_exportReport(token, type, filters)` — type: individual/village/caregiver/monthly/benefit/overdue/highrisk

## 🔔 Messaging & Settings (MessagingService.gs)
- `api_sendLineAlert` · `api_getNotifications` · `api_resendNotification`
- `api_notifyUpcomingVisits/OverdueVisits/HighRiskMentalHealth/AbnormalVitalSigns/PPSDecline`
- `api_getSettings` (mask token) · `api_saveSettings`

---

# 4. Security Checklist

| ข้อกำหนด | สถานะ | การทำงาน |
|----------|:-----:|----------|
| **Password hash** | ✅ | HMAC-SHA256 × 10,000 รอบ + UUID salt (เก็บแยก 2 คอลัมน์) ไม่เก็บ plain text |
| **Session check** | ✅ | Token (UUID) ใน CacheService TTL 8 ชม. ทุก API เรียก `requireAuth_` |
| **Role-based access** | ✅ | `PERMISSION_MATRIX` 4 roles × 11 modules × 6 actions ตรวจทุก mutation |
| **CID masked** | ✅ | เก็บเต็มใน Sheet · ส่ง client เป็น `X-XXXX-XXXXX-XX-x` เสมอ (ทุก role) |
| **Input validation** | ✅ | CID Mod-11 checksum, required fields, ช่วงคะแนน ADL/PPS, ตรวจ MIME รูป |
| **PDPA consent** | ✅ | บังคับ checkbox ก่อนบันทึกผู้ป่วยใหม่ + ก่อนแนบรูป (backend reject ถ้าไม่ยินยอม) |
| **ไม่แสดงข้อมูลเกินสิทธิ์** | ✅ | `_filterByRole_`: cm เห็นเฉพาะที่เป็น CareManager, cg เฉพาะ Caregiver |
| **กันผู้ไม่ login** | ✅ | Frontend `x-show="user"` · Backend ทุก data endpoint `requireAuth_` |
| **Audit log** | ✅ | LOGIN/LOGOUT/CREATE/UPDATE/DELETE/EXPORT/UPLOAD/SEND_LINE/APPROVE บันทึก AuditLogs |

> **หมายเหตุ:** ฟังก์ชันที่ไม่ต้อง login มีเฉพาะ `api_getAppConfig`, `api_validateCID`, `api_logClientError`, interpret/calculate (คำนวณล้วน) — ไม่มีการเปิดเผยข้อมูลผู้ป่วย

---

# 5. คู่มือติดตั้ง (Deploy Guide)

## ขั้นที่ 1 — สร้าง Google Sheet
1. เข้า [sheets.google.com](https://sheets.google.com) ด้วยบัญชี Google ขององค์กร
2. คลิก **+ ว่าง (Blank)** สร้างสเปรดชีตใหม่
3. ตั้งชื่อไฟล์ เช่น `LTC Care Report - ตำบล...`
4. **ไม่ต้องสร้างชีตเอง** — ระบบจะสร้าง 13 ชีตให้อัตโนมัติในขั้นที่ 4

## ขั้นที่ 2 — เปิด Apps Script
1. ในสเปรดชีต ไปที่เมนู **ส่วนขยาย (Extensions)** → **Apps Script**
2. จะเปิดหน้าต่าง Apps Script Editor ขึ้นมา (project ผูกกับสเปรดชีตนี้)

## ขั้นที่ 3 — สร้างไฟล์ .gs และ .html
**วิธี A — ใช้ clasp (แนะนำสำหรับ dev):**
```bash
npm install -g @google/clasp
clasp login
clasp clone <SCRIPT_ID>      # หรือ clasp create
clasp push --force           # อัปโหลดไฟล์ทั้งหมด
```
**วิธี B — คัดลอกด้วยมือ:**
1. ลบไฟล์ `Code.gs` ตัวอย่าง → สร้างไฟล์ตามรายการในข้อ 2
2. ไฟล์ `.gs`: กด **+** ข้าง Files → Script → วางโค้ด
3. ไฟล์ `.html`: กด **+** → HTML → ตั้งชื่อ (เช่น `index`, `style`, `dashboard`) → วางโค้ด
4. แก้ `appsscript.json`: เมนู ⚙️ Project Settings → เปิด "Show appsscript.json"

## ขั้นที่ 4 — รัน setupSheets()
1. ใน Apps Script Editor เลือกฟังก์ชัน **`setupSheets`** จาก dropdown ด้านบน
2. กด **Run (▶)**
3. ครั้งแรกจะขออนุญาต → **Review permissions** → เลือกบัญชี → **Advanced** → **Go to (unsafe)** → **Allow**
4. ระบบจะสร้าง 13 ชีต + ค่าตั้งต้น + **admin user เริ่มต้น**
   - หรือใช้เมนูในสเปรดชีต: **⚙️ LTC Admin → 🔧 ตั้งค่าระบบครั้งแรก**

## ขั้นที่ 5 — สร้างโฟลเดอร์ Google Drive สำหรับรูปภาพ
1. เข้า [drive.google.com](https://drive.google.com) → **ใหม่ → โฟลเดอร์** ตั้งชื่อ เช่น `LTC_Photos`
2. เปิดโฟลเดอร์ → คัดลอก **Folder ID** จาก URL
   `https://drive.google.com/drive/folders/`**`1AbC...XyZ`** ← ส่วนนี้คือ Folder ID
3. นำไปกรอกในขั้นที่ 6 (หรือเว้นว่างให้ระบบสร้างอัตโนมัติเมื่ออัปโหลดรูปครั้งแรก)

## ขั้นที่ 6 — กรอกค่าใน Sheet "Setting"
เปิดชีต **Setting** แก้คอลัมน์ `SettingValue` (หรือทำผ่านหน้า ⚙️ ตั้งค่าในเว็บแอปหลัง deploy):

| SettingKey | ตัวอย่างค่า |
|-----------|------------|
| `APP_NAME` | LTC Care Report ตำบล... |
| `ORG_NAME` | อบต./เทศบาล... |
| `SUBDISTRICT_NAME` / `DISTRICT_NAME` | ตำบล / อำเภอ |
| `DRIVE_FOLDER_LTC_PHOTO` | Folder ID จากขั้นที่ 5 |
| `LINE_CHANNEL_ACCESS_TOKEN` | (ขั้นที่ 12) |
| `LINE_GROUP_ID` | (ขั้นที่ 12) |
| `LTC_BUDGET_PER_PERSON_YEAR` | 5000 |
| `WEBAPP_URL` | (ได้หลัง deploy ขั้นที่ 7) |

## ขั้นที่ 7 — Deploy เป็น Web App
1. Apps Script Editor → **Deploy → New deployment**
2. ⚙️ (Select type) → **Web app**
3. กรอก Description เช่น "LTC v2.0"
4. ตั้งค่า Execute as / access (ขั้นที่ 8) → **Deploy**
5. คัดลอก **Web app URL** → นำไปกรอก `WEBAPP_URL` ในชีต Setting

## ขั้นที่ 8 — ตั้งค่า Execute as / Who has access
- **Execute as:** `Me (เจ้าของบัญชี)` — เพื่อให้ระบบเข้าถึง Sheet/Drive ได้
- **Who has access:** `Anyone` — เพื่อให้ผู้ใช้เปิด URL ได้ (ระบบมี Login ป้องกันชั้นในเอง)

> ⚠️ ทุกครั้งที่แก้โค้ด ต้อง **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy** เพื่อให้ URL เดิมอัปเดต

## ขั้นที่ 9 — ทดสอบ Login
1. เปิด Web app URL ในเบราว์เซอร์ (มือถือหรือคอม)
2. Login ด้วยบัญชีเริ่มต้น: **username `admin` / password `admin123`**
3. ✅ ควรเข้าหน้า Dashboard ได้
4. **เปลี่ยนรหัสผ่าน admin ทันที** (หน้าตั้งค่า หรือเมนู ⚙️ LTC Admin → รีเซ็ต)

## ขั้นที่ 10 — เพิ่มผู้ใช้งาน
> หน้าจัดการผู้ใช้แบบเต็มอยู่ใน roadmap — ปัจจุบันเพิ่มผ่านชีต **Users** โดยตรง:
1. เปิดชีต **Users** → เพิ่มแถวใหม่
2. กรอก: `UserID` (เช่น USR+ตัวเลข), `Username`, `FullName`, `Role` (admin/cm/cg/viewer), `IsActive`=TRUE
3. ตั้งรหัสผ่าน: รันฟังก์ชัน `hashPassword("รหัสที่ต้องการ")` ใน Apps Script → คัดลอก hash+salt ไปใส่คอลัมน์ `PasswordHash`/`PasswordSalt`
   - หรือคัดลอกค่า hash/salt จาก admin แล้วให้ผู้ใช้ใหม่ใช้รหัสเดียวกันชั่วคราวแล้วเปลี่ยนเอง

## ขั้นที่ 11 — การใช้งานพื้นฐาน
1. **เพิ่มผู้รับบริการ:** เมนูผู้รับบริการ → + เพิ่ม → กรอกข้อมูล + ยินยอม PDPA → บันทึก
2. **บันทึกการเยี่ยม:** เมนูการเยี่ยมบ้าน → เลือกผู้ป่วย → กรอก → (แนบรูป) → บันทึก
3. **ทำแบบประเมิน:** เมนูแบบประเมิน → เลือกผู้ป่วย+visit → ทำ 5 ขั้น
4. **ดูแผนที่/รายงาน:** เมนูแผนที่ / รายงาน

## ขั้นที่ 12 — ตั้งค่า LINE Messaging API
1. เข้า [developers.line.biz](https://developers.line.biz) → สร้าง **Provider** → **Messaging API channel**
2. คัดลอก **Channel access token (long-lived)** จากแท็บ Messaging API
3. หา **Group ID / User ID** ปลายทาง (ใช้ webhook หรือเครื่องมือช่วย)
4. ในเว็บแอป → ⚙️ ตั้งค่า → แท็บ LINE → กรอก Token + Group ID → บันทึก → **ทดสอบส่งข้อความ**
5. (ทางเลือก) ตั้งแจ้งเตือนอัตโนมัติ: Apps Script → ⏰ Triggers → Add Trigger →
   เลือก `notifyOverdueVisits` / `notifyUpcomingVisits` → Time-driven → Day timer → 08:00

## ขั้นที่ 13 — แก้ปัญหาที่พบบ่อย

| ปัญหา | สาเหตุ / วิธีแก้ |
|-------|----------------|
| Login ไม่ได้ "Session หมดอายุ" | เกิน 8 ชม. → login ใหม่ |
| "ไม่พบ Sheet" | ยังไม่ได้รัน `setupSheets()` → รันขั้นที่ 4 |
| เลข 0 นำหน้าหาย (เบอร์/CID) | คอลัมน์ตั้ง format `@` แล้ว — ถ้ายังเพี้ยน ตรวจว่าใช้ appendData (มี apostrophe prefix) |
| รูปอัปโหลดไม่ได้ | ตรวจ OAuth scope = `drive` (เต็ม) + re-deploy + authorize ใหม่ |
| LINE ไม่ส่ง | ตรวจ Token/Group ID ในตั้งค่า · ดูคอลัมน์ LineResponse ในชีต Notifications |
| แก้โค้ดแล้วเว็บไม่เปลี่ยน | ต้อง Deploy เวอร์ชันใหม่ (ขั้นที่ 8) |
| หน้าขาว/error | เปิด Console (F12) ดู error · ตรวจ AuditLogs |
| แผนที่ไม่ขึ้น | ผู้ป่วยต้องมีพิกัด Lat/Lng · กดปุ่ม 📍 GPS ตอนเพิ่มผู้ป่วย |

---

# 6. Checklist ก่อนใช้งานจริง

- [ ] รัน `setupSheets()` สำเร็จ — มีครบ 13 ชีต
- [ ] เปลี่ยนรหัสผ่าน `admin` จาก `admin123` แล้ว
- [ ] OAuth scope = `drive` (เต็ม), authorize ใหม่หลังอัปเกรด scope
- [ ] Deploy เป็น Web App: Execute as = Me, Access = Anyone
- [ ] กรอก `WEBAPP_URL` ในชีต Setting
- [ ] กรอกข้อมูลองค์กร (ORG_NAME, ตำบล, อำเภอ)
- [ ] สร้าง/ระบุ `DRIVE_FOLDER_LTC_PHOTO`
- [ ] ตั้งค่า LINE Token + Group ID + ทดสอบส่งสำเร็จ
- [ ] เพิ่มผู้ใช้ cm/cg อย่างน้อยอย่างละ 1 คน + ทดสอบ login
- [ ] ทดสอบ: เพิ่มผู้ป่วย → เยี่ยม → ประเมิน → ดูแผนที่ → export รายงาน
- [ ] ตรวจ AuditLogs มีบันทึกครบ
- [ ] (ทางเลือก) ตั้ง Trigger แจ้งเตือนอัตโนมัติ 08:00
- [ ] แจ้ง/อบรมผู้ใช้ + แจกคู่มือ Caregiver

---

# 7. คู่มือผู้ดูแลระบบ (Admin)

**สิทธิ์ admin:** จัดการได้ทุกอย่าง — ผู้ป่วยทุกราย, ผู้ใช้, ตั้งค่า, รายงาน, Audit Log, แจ้งเตือน

### งานประจำ
- **ตรวจ Dashboard** ทุกเช้า — ดูเคสเลยกำหนด / เสี่ยงสูง / Palliative
- **ส่งแจ้งเตือน** (⚙️ ตั้งค่า → แจ้งเตือน) — กดส่งเอง หรือใช้ Trigger อัตโนมัติ
- **ดู Audit Log** — ตรวจสอบการเข้าใช้งานและการแก้ไขข้อมูล
- **จัดการผู้ใช้** — เพิ่ม/ปิดบัญชีในชีต Users (ตั้ง IsActive=FALSE เพื่อปิด)

### ความปลอดภัยข้อมูล (PDPA)
- CID ถูก mask อัตโนมัติทุกหน้า — เลขเต็มอยู่ในชีตเท่านั้น (จำกัดสิทธิ์เข้าถึงชีต)
- จำกัดสิทธิ์เปิดไฟล์ Google Sheet เฉพาะผู้ดูแลระบบ
- เก็บความยินยอม PDPA ก่อนบันทึกข้อมูล/รูปทุกครั้ง
- รูปภาพเก็บใน Drive folder ที่จำกัดสิทธิ์ — ตรวจสอบการแชร์เป็นระยะ

### การสำรองข้อมูล
- Google Sheets มี version history อัตโนมัติ (ไฟล์ → ประวัติเวอร์ชัน)
- แนะนำ Export สำเนา Sheet เป็น .xlsx รายเดือน

---

# 8. คู่มือผู้ดูแล (Caregiver) ฉบับย่อ
ดูไฟล์แยก: [CAREGIVER_GUIDE.md](CAREGIVER_GUIDE.md)
