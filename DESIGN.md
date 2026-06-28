# LTC Care Report — System Design Document (Phase 1)
# ระบบรายงานการดูแลผู้สูงอายุและผู้ที่มีภาวะพึ่งพิง
# เวอร์ชัน: 1.0 | วันที่ออกแบบ: 2026-06-28

---

## 1. SYSTEM OVERVIEW

### วัตถุประสงค์
ระบบ LTC Care Report เป็น Web Application บน Google Apps Script ใช้สำหรับ:
- บันทึกและติดตามการดูแลผู้สูงอายุ/ผู้ที่มีภาวะพึ่งพิงในระดับตำบล
- รายงานการให้บริการตาม NHSO LTC Benefit Package
- วิเคราะห์ผลลัพธ์การดูแล (ADL, PPS, สุขภาพจิต)
- แจ้งเตือนและติดตามผ่าน LINE Notify

### Tech Stack
- **Backend**: Google Apps Script (GAS) – V8 Runtime
- **Database**: Google Sheets (13 sheets)
- **Frontend**: HTML5 SPA + Tailwind CSS CDN + Alpine.js
- **Font**: Noto Sans Thai (Google Fonts)
- **Alert**: SweetAlert2
- **Map**: Leaflet + OpenStreetMap
- **Storage**: Google Drive (รูปภาพ)
- **Notification**: LINE Notify API

### Architecture Pattern
- SPA (Single Page Application) — `doGet()` เสิร์ฟ shell HTML ครั้งเดียว
- `google.script.run` RPC ผ่าน Promise wrapper (`rpc()`)
- Session Token ใน `CacheService.getScriptCache()` (expiry 8 ชม.)
- **Result Envelope**: ทุก server function คืน `{ok: boolean, data?, message?}`
- Date ใน Sheet: `yyyy-MM-dd` | Date ใน UI: `dd/MM/yyyy พ.ศ.`
- CID ใน Sheet: เก็บครบ 13 หลัก | ใน UI: mask เป็น `****-****-*****` แสดงแค่ 4 ตัวท้าย

---

## 2. USER ROLE WORKFLOW

### บทบาทและคำอธิบาย

| Role | รหัส | คำอธิบาย |
|------|------|----------|
| ผู้ดูแลระบบ | admin | ควบคุมทั้งระบบ จัดการ Users, Settings, ดู Audit Log |
| Care Manager | cm | วางแผนดูแล, อนุมัติ Care Plan, ดูรายงานทุกคน |
| Caregiver | cg | บันทึกการเยี่ยมบ้าน, กรอกแบบประเมิน, อัปโหลดรูป |
| ผู้ดูข้อมูล | viewer | อ่านอย่างเดียว ไม่แก้ไขข้อมูล |

### Workflow หลัก

```
[admin] ─── ตั้งค่าระบบ ──→ สร้าง Users ──→ กำหนด Setting
                                  ↓
[cm] ──── รับผู้ป่วยเข้าระบบ ──→ สร้าง Patient ──→ วาง CarePlan
                                       ↓
                            มอบหมาย CG ──→ กำหนดตาราง Visit
                                                 ↓
[cg] ──── รับการมอบหมาย ──→ เยี่ยมบ้าน (Visit)
                                       ↓
                     ┌─────────────────┼─────────────────┐
                     ↓                 ↓                 ↓
              บันทึก Vitals     ประเมิน ADL        ประเมิน PPS
                     ↓                 ↓                 ↓
              คัดกรองสุขภาพจิต   รายงานบริการ     อัปโหลดรูป
                                  (Benefit)
                                       ↓
[cm] ──── Review Visit ──→ อนุมัติ Benefit Report
                                       ↓
[admin/cm] ── ดู Reports ──→ Export CSV ──→ ส่ง NHSO
```

---

## 3. COMPLETE GOOGLE SHEETS STRUCTURE

### Sheet List (13 sheets)

| # | Sheet Name | Description | Primary Key |
|---|-----------|-------------|-------------|
| 1 | Setting | ค่าคงที่และการตั้งค่าระบบ | SettingKey |
| 2 | Users | บัญชีผู้ใช้และ Authentication | UserID |
| 3 | Patients | ทะเบียนผู้รับบริการ | PatientID |
| 4 | CarePlans | แผนการดูแลรายบุคคล | CarePlanID |
| 5 | Visits | บันทึกการเยี่ยมบ้าน (ศูนย์กลาง) | VisitID |
| 6 | VitalSigns | สัญญาณชีพ | VitalSignID |
| 7 | ADLAssessments | แบบประเมิน ADL (Barthel Index) | ADLAssessmentID |
| 8 | PPSAAssessments | Palliative Performance Scale | PPSAAssessmentID |
| 9 | MentalHealthScreenings | TGDS-15 / TMSE | ScreeningID |
| 10 | ServiceBenefitReports | รายงานบริการ LTC รายเดือน | ReportID |
| 11 | Photos | รูปภาพการเยี่ยมบ้าน | PhotoID |
| 12 | AuditLogs | ประวัติการใช้งานระบบ | LogID |
| 13 | Notifications | การแจ้งเตือนและ LINE Notify Log | NotificationID |

> **หมายเหตุ**: Sessions ใช้ `CacheService.getScriptCache()` เท่านั้น ไม่สร้าง Sheet เพื่อลด quota

---

## 4. DATA DICTIONARY PER SHEET

---

### SHEET 1: Setting

| Column | Type | Required | Description | Example |
|--------|------|----------|-------------|---------|
| SettingKey | String | ✅ | Primary Key (unique key name) | `ORG_NAME` |
| SettingValue | String | ✅ | ค่าของ setting | `อบต.บ้านดี` |
| DataType | String | | text / number / json / boolean | `text` |
| Description | String | | คำอธิบาย | `ชื่อองค์กร` |
| UpdatedAt | ISO DateTime | | วันที่แก้ไขล่าสุด | `2026-06-28T10:00:00.000Z` |
| UpdatedBy | UserID | | ผู้แก้ไขล่าสุด | `USR17196000001234` |

**Default Setting Keys:**

| SettingKey | Default Value | Description |
|-----------|---------------|-------------|
| ORG_NAME | อบต. | ชื่อองค์กร |
| ORG_CODE | | รหัส อปท. |
| ORG_SUBDISTRICT | | ตำบล |
| ORG_DISTRICT | | อำเภอ |
| ORG_PROVINCE | | จังหวัด |
| FISCAL_YEAR | (ปัจจุบัน) | ปีงบประมาณ ค.ศ. |
| LTC_BUDGET_PER_PERSON | 5000 | งบต่อราย (บาท/ปี) |
| LINE_NOTIFY_TOKEN | | LINE Notify Token |
| BENEFIT_ITEMS | JSON Array | รายการบริการ LTC |
| MAP_DEFAULT_LAT | 13.736717 | Latitude ค่าเริ่มต้นแผนที่ |
| MAP_DEFAULT_LNG | 100.523186 | Longitude ค่าเริ่มต้นแผนที่ |
| APP_VERSION | 1.0.0 | เวอร์ชันระบบ |

---

### SHEET 2: Users

| Column | Type | Required | Description | Example |
|--------|------|----------|-------------|---------|
| UserID | String | ✅ PK | `USR` + timestamp + random4 | `USR17196000001234` |
| Username | String | ✅ UNIQUE | ชื่อผู้ใช้ (ตัวเล็ก, ไม่มีช่องว่าง) | `somchai_cg` |
| PasswordHash | String | ✅ | PBKDF2/HMAC-SHA256 hash | (hash string) |
| PasswordSalt | String | ✅ | UUID salt | (uuid) |
| FullName | String | ✅ | ชื่อ-นามสกุลเต็ม | `นายสมชาย ใจดี` |
| NickName | String | | ชื่อเล่น | `ชาย` |
| Role | Enum | ✅ | admin / cm / cg / viewer | `cg` |
| Phone | String (Text) | | เบอร์โทรศัพท์ | `0812345678` |
| Email | String | | อีเมล | `somchai@mail.com` |
| OrgName | String | | หน่วยงาน | `อบต.บ้านดี` |
| IsActive | Boolean | ✅ | true/false | `true` |
| CreatedAt | ISO DateTime | ✅ | | `2026-06-28T10:00:00.000Z` |
| UpdatedAt | ISO DateTime | | | |
| LastLoginAt | ISO DateTime | | | |
| CreatedBy | UserID | | ผู้สร้าง account | |

> **Text Format**: `Phone` ต้องตั้ง column format = `@` (Plain text) ป้องกัน 0 นำหน้าหาย

---

### SHEET 3: Patients

| Column | Type | Required | Description | Example |
|--------|------|----------|-------------|---------|
| PatientID | String | ✅ PK | `PT` + timestamp + random4 | `PT17196000001234` |
| HN | String (Text) | | เลข Hospital Number | `HN-2567-0001` |
| Prefix | String | ✅ | นาย/นาง/นางสาว/เด็กชาย/เด็กหญิง | `นาง` |
| FirstName | String | ✅ | ชื่อจริง | `สมหญิง` |
| LastName | String | ✅ | นามสกุล | `ใจงาม` |
| CID | String (Text) | | เลขบัตรประชาชน 13 หลัก (เก็บเต็ม, แสดง mask) | `1234567890123` |
| DOB | Date (yyyy-MM-dd) | | วันเกิด | `1940-05-15` |
| Age | Integer | | อายุ (คำนวณจาก DOB ทุกครั้ง ไม่ได้เก็บถาวร) | `85` |
| Gender | Enum | ✅ | ชาย / หญิง / อื่นๆ | `หญิง` |
| Phone | String (Text) | | โทรศัพท์ผู้ป่วยหรือญาติ | `0891234567` |
| Address | String | | บ้านเลขที่/ซอย/ถนน | `123/4 ซ.สุขใจ` |
| VillageNo | String (Text) | | หมู่ที่ | `5` |
| Subdistrict | String | | ตำบล | `บ้านดี` |
| District | String | | อำเภอ | `เมือง` |
| Province | String | | จังหวัด | `เชียงใหม่` |
| PostalCode | String (Text) | | รหัสไปรษณีย์ | `50000` |
| Lat | Decimal | | Latitude GPS | `18.788901` |
| Lng | Decimal | | Longitude GPS | `98.993280` |
| CareLevel | Enum | ✅ | ระดับ 1 / ระดับ 2 / ระดับ 3 / ติดบ้าน / ติดเตียง | `ระดับ 2` |
| AssignedCgID | UserID FK | | ผู้ดูแล (CG) ที่รับผิดชอบ | `USR1719600...` |
| AssignedCmID | UserID FK | | Care Manager | `USR1719600...` |
| ActiveCarePlanID | CarePlanID FK | | Care Plan ที่ active อยู่ | `CP1719600...` |
| EnrollDate | Date (yyyy-MM-dd) | ✅ | วันที่รับเข้าระบบ LTC | `2026-01-15` |
| DischargeDate | Date (yyyy-MM-dd) | | วันที่ออกจากระบบ | |
| DischargeReason | Enum | | เสียชีวิต/ฟื้นตัว/ย้าย/ถอนตัว | |
| MedicalConditions | String | | โรคประจำตัว (คั่นด้วย comma) | `เบาหวาน, ความดัน` |
| Allergies | String | | แพ้ยา/อาหาร | `แพ้ penicillin` |
| EmergencyContactName | String | | ชื่อผู้ติดต่อฉุกเฉิน | `นายดำ ใจดี` |
| EmergencyContactPhone | String (Text) | | โทร.ผู้ติดต่อฉุกเฉิน | `0812223333` |
| IsActive | Boolean | ✅ | true = active, false = discharged | `true` |
| FiscalYear | Integer | | ปีงบประมาณที่รับเข้าระบบ (ค.ศ.) | `2026` |
| Notes | String | | หมายเหตุเพิ่มเติม | |
| CreatedAt | ISO DateTime | ✅ | | |
| UpdatedAt | ISO DateTime | | | |
| CreatedBy | UserID FK | | ผู้เพิ่มข้อมูล | |

> **CID Masking Rule**: แสดงใน UI เป็น `X-XXXX-XXXXX-XX-X` (ซ่อนทั้งหมด) หรือ `*********${cid.slice(-4)}` (แสดง 4 ตัวท้าย)
> **Text Format**: `CID`, `Phone`, `HN`, `PostalCode`, `EmergencyContactPhone`, `VillageNo` → ตั้ง column = `@`

---

### SHEET 4: CarePlans

| Column | Type | Required | Description | Example |
|--------|------|----------|-------------|---------|
| CarePlanID | String | ✅ PK | `CP` + timestamp + random4 | `CP17196000001234` |
| PatientID | PatientID FK | ✅ | ผู้ป่วยที่เป็นเจ้าของ Care Plan | `PT1719600...` |
| PlanDate | Date (yyyy-MM-dd) | ✅ | วันที่ทำ Care Plan | `2026-01-20` |
| FiscalYear | Integer | ✅ | ปีงบประมาณ (ค.ศ.) | `2026` |
| GoalShortTerm | String | | เป้าหมายระยะสั้น (1-3 เดือน) | `ลด BP ให้ <140/90` |
| GoalLongTerm | String | | เป้าหมายระยะยาว (6-12 เดือน) | `คง ADL ระดับ 2` |
| CareNeeds | JSON String | | ความต้องการการดูแล (Array) | `["การดูแลแผล","โภชนาการ"]` |
| PlannedServices | JSON String | | บริการที่วางแผน (Array of service IDs) | `["B01","B02","B06"]` |
| AssignedCgID | UserID FK | ✅ | CG ที่รับผิดชอบ | |
| VisitFrequency | String | | ความถี่การเยี่ยม | `สัปดาห์ละ 2 ครั้ง` |
| ReviewDate | Date (yyyy-MM-dd) | | วันที่นัดประเมินซ้ำ | `2026-04-20` |
| Status | Enum | ✅ | active / completed / cancelled | `active` |
| ApprovedBy | UserID FK | | CM ที่อนุมัติ Care Plan | |
| ApprovedAt | ISO DateTime | | | |
| Notes | String | | | |
| CreatedAt | ISO DateTime | ✅ | | |
| UpdatedAt | ISO DateTime | | | |
| CreatedBy | UserID FK | ✅ | | |

---

### SHEET 5: Visits

| Column | Type | Required | Description | Example |
|--------|------|----------|-------------|---------|
| VisitID | String | ✅ PK | `VT` + timestamp + random4 | `VT17196000001234` |
| PatientID | PatientID FK | ✅ | ผู้ป่วย | `PT1719600...` |
| **VisitNo** | Integer | ✅ AUTO | ลำดับการเยี่ยมของผู้ป่วยคนนี้ (1, 2, 3...) | `5` |
| VisitDate | Date (yyyy-MM-dd) | ✅ | วันที่เยี่ยม | `2026-06-15` |
| VisitTime | String (HH:mm) | | เวลาเยี่ยม | `09:30` |
| VisitType | Enum | ✅ | home_visit / clinic / phone / emergency | `home_visit` |
| VisitorID | UserID FK | ✅ | ผู้เยี่ยม (CG/CM/admin) | |
| CarePlanID | CarePlanID FK | | Care Plan ที่เชื่อมอยู่ | |
| VisitStatus | Enum | ✅ | completed / cancelled / no_show | `completed` |
| ChiefComplaint | String | | อาการหลักที่พบ | `ปวดเข่า บวม` |
| ClinicalSummary | String | | สรุปการเยี่ยม | |
| Interventions | String | | การดูแลที่ให้ | |
| NextVisitDate | Date (yyyy-MM-dd) | | วันนัดเยี่ยมครั้งถัดไป | `2026-06-22` |
| HasVitalSigns | Boolean | | มีการบันทึก Vitals ในการเยี่ยมนี้ | `true` |
| HasADL | Boolean | | มีการประเมิน ADL | `false` |
| HasPPS | Boolean | | มีการประเมิน PPS | `false` |
| HasMentalHealth | Boolean | | มีการคัดกรองสุขภาพจิต | `false` |
| HasBenefitReport | Boolean | | มีการบันทึกรายงานบริการ | `true` |
| CreatedAt | ISO DateTime | ✅ | | |
| UpdatedAt | ISO DateTime | | | |
| CreatedBy | UserID FK | ✅ | | |

> **VisitNo Auto-Calculation**: ตอนสร้าง Visit ใหม่ → `COUNT(Visits WHERE PatientID = X) + 1`
> ใช้ `LockService` ป้องกัน race condition ในการ assign VisitNo

---

### SHEET 6: VitalSigns

| Column | Type | Required | Description | Unit | Example |
|--------|------|----------|-------------|------|---------|
| VitalSignID | String | ✅ PK | `VS` + timestamp + random4 | | |
| VisitID | VisitID FK | ✅ | การเยี่ยมที่เชื่อม | | |
| PatientID | PatientID FK | ✅ | (denormalized) | | |
| MeasuredDate | Date (yyyy-MM-dd) | ✅ | วันที่วัด | | `2026-06-15` |
| BPSystolic | Integer | | ความดันตัวบน | mmHg | `130` |
| BPDiastolic | Integer | | ความดันตัวล่าง | mmHg | `85` |
| BPPosition | Enum | | sitting / lying / standing | | `sitting` |
| BPInterpretation | String | | (computed) | | `ความดันสูงระดับ 1` |
| Pulse | Integer | | ชีพจร | ครั้ง/นาที | `78` |
| Temperature | Decimal | | อุณหภูมิ | °C | `36.8` |
| SpO2 | Integer | | ความอิ่มตัวออกซิเจน | % | `97` |
| RespiratoryRate | Integer | | อัตราการหายใจ | ครั้ง/นาที | `18` |
| Weight | Decimal | | น้ำหนัก | กก. | `58.5` |
| Height | Decimal | | ส่วนสูง | ซม. | `155.0` |
| BMI | Decimal | | (computed: kg/m²) | | `24.3` |
| BMIInterpretation | String | | (computed) | | `ปกติ` |
| WaistCircumference | Decimal | | รอบเอว | ซม. | `82.0` |
| BloodGlucose | Decimal | | น้ำตาลในเลือด (optional) | mg/dL | `126.0` |
| RecordedBy | UserID FK | ✅ | ผู้บันทึก | | |
| Notes | String | | | | |
| CreatedAt | ISO DateTime | ✅ | | | |

---

### SHEET 7: ADLAssessments (Barthel Index)

| Column | Type | Required | Description | Score Range |
|--------|------|----------|-------------|-------------|
| ADLAssessmentID | String | ✅ PK | `ADL` + timestamp + random4 | |
| VisitID | VisitID FK | ✅ | การเยี่ยมที่เชื่อม | |
| PatientID | PatientID FK | ✅ | (denormalized) | |
| AssessedDate | Date (yyyy-MM-dd) | ✅ | | |
| Item1_Feeding | Integer | ✅ | การรับประทานอาหาร | 0/5/10 |
| Item2_Bathing | Integer | ✅ | การอาบน้ำ | 0/5 |
| Item3_Grooming | Integer | ✅ | การดูแลความสะอาดร่างกาย | 0/5 |
| Item4_Dressing | Integer | ✅ | การแต่งตัว | 0/5/10 |
| Item5_BowelControl | Integer | ✅ | การขับถ่ายอุจจาระ | 0/5/10 |
| Item6_BladderControl | Integer | ✅ | การขับถ่ายปัสสาวะ | 0/5/10 |
| Item7_ToiletUse | Integer | ✅ | การใช้ห้องน้ำ | 0/5/10 |
| Item8_Transfer | Integer | ✅ | การเคลื่อนย้าย (เตียง-เก้าอี้) | 0/5/10/15 |
| Item9_Mobility | Integer | ✅ | การเดิน | 0/5/10/15 |
| Item10_Stairs | Integer | ✅ | การขึ้น-ลงบันได | 0/5/10 |
| TotalScore | Integer | ✅ AUTO | ผลรวม (0-100) | 0–100 |
| ADLLevel | String | ✅ AUTO | ช่วยตนเองได้ / บางส่วน / ปานกลาง / มาก | |
| DependencyLevel | Enum | AUTO | ระดับ 1 / ระดับ 2 / ระดับ 3 | |
| ComparedToPrevious | Enum | AUTO | ดีขึ้น / คงที่ / แย่ลง / ครั้งแรก | |
| PreviousScore | Integer | | คะแนนครั้งก่อน | |
| AssessedBy | UserID FK | ✅ | | |
| Notes | String | | | |
| CreatedAt | ISO DateTime | ✅ | | |

**ADL Level Mapping:**
- 81–100 = ช่วยตนเองได้ (ระดับ 1)
- 61–80 = ต้องการความช่วยเหลือบางส่วน (ระดับ 1)
- 21–60 = ต้องการความช่วยเหลือปานกลาง (ระดับ 2)
- 0–20 = ต้องการความช่วยเหลือมาก (ระดับ 3)

---

### SHEET 8: PPSAAssessments (Palliative Performance Scale)

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| PPSAAssessmentID | String | ✅ PK | `PPSA` + timestamp + random4 |
| VisitID | VisitID FK | ✅ | |
| PatientID | PatientID FK | ✅ | (denormalized) |
| AssessedDate | Date (yyyy-MM-dd) | ✅ | |
| PPSScore | Integer | ✅ | 0/10/20/30/40/50/60/70/80/90/100 |
| Ambulation | Enum | ✅ | full / reduced / mainly_sit_lie / mainly_in_bed / totally_bed_bound |
| ActivityLevel | Enum | ✅ | normal / some_disease / unable_normal / unable_hobby / unable_any |
| SelfCare | Enum | ✅ | full / occasional_assist / considerable_assist / mainly_cared / total_care |
| Intake | Enum | ✅ | normal / reduced / minimal / mouth_care_only |
| Consciousness | Enum | ✅ | full / full_or_confusion / full_or_drowsy / drowsy_or_coma |
| PPSLevel | String | AUTO | คำอธิบายระดับ (computed) |
| CareCategory | Enum | AUTO | active / supportive / palliative (computed จาก PPSScore) |
| ComparedToPrevious | Enum | AUTO | ดีขึ้น / คงที่ / แย่ลง / ครั้งแรก |
| PreviousScore | Integer | | |
| AssessedBy | UserID FK | ✅ | |
| Notes | String | | |
| CreatedAt | ISO DateTime | ✅ | |

**PPS → CareCategory Mapping:**
- 70–100 = active (ดูแลแบบ Active)
- 40–60 = supportive (ดูแลแบบประคับประคอง)
- 0–30 = palliative (Palliative Care)

---

### SHEET 9: MentalHealthScreenings

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| ScreeningID | String | ✅ PK | `MH` + timestamp + random4 |
| VisitID | VisitID FK | ✅ | |
| PatientID | PatientID FK | ✅ | (denormalized) |
| ScreenedDate | Date (yyyy-MM-dd) | ✅ | |
| ScreeningType | Enum | ✅ | TGDS-15 / TMSE |
| **TGDS Questions** (ถ้า Type = TGDS-15) | | | |
| TGDS_Q1 | Enum | | yes / no |
| TGDS_Q2 | Enum | | yes / no |
| TGDS_Q3 | Enum | | yes / no |
| TGDS_Q4 | Enum | | yes / no |
| TGDS_Q5 | Enum | | yes / no |
| TGDS_Q6 | Enum | | yes / no |
| TGDS_Q7 | Enum | | yes / no |
| TGDS_Q8 | Enum | | yes / no |
| TGDS_Q9 | Enum | | yes / no |
| TGDS_Q10 | Enum | | yes / no |
| TGDS_Q11 | Enum | | yes / no |
| TGDS_Q12 | Enum | | yes / no |
| TGDS_Q13 | Enum | | yes / no |
| TGDS_Q14 | Enum | | yes / no |
| TGDS_Q15 | Enum | | yes / no |
| **TMSE Sections** (ถ้า Type = TMSE) | | | |
| TMSE_Orientation | Integer | | คะแนน Orientation (0-10) |
| TMSE_Registration | Integer | | คะแนน Registration (0-3) |
| TMSE_Attention | Integer | | คะแนน Attention (0-5) |
| TMSE_Recall | Integer | | คะแนน Recall (0-3) |
| TMSE_Language | Integer | | คะแนน Language (0-9) |
| **Results** | | | |
| TotalScore | Integer | AUTO | TGDS: 0-15 / TMSE: 0-30 |
| InterpretationLevel | String | AUTO | ระดับผลการประเมิน |
| RiskLevel | Enum | AUTO | low / medium / high |
| RequiresReferral | Boolean | AUTO | true ถ้าผลเสี่ยงสูง |
| ScreenedBy | UserID FK | ✅ | |
| Notes | String | | |
| CreatedAt | ISO DateTime | ✅ | |

**TGDS Score Interpretation:**
- 0–5 = ไม่มีภาวะซึมเศร้า (RiskLevel: low)
- 6–10 = มีภาวะซึมเศร้าเล็กน้อย-ปานกลาง (RiskLevel: medium)
- 11–15 = มีภาวะซึมเศร้ารุนแรง (RiskLevel: high, RequiresReferral: true)

**TMSE Score Interpretation:**
- 24–30 = ปกติ (RiskLevel: low)
- 18–23 = สมรรถภาพสมองบกพร่องเล็กน้อย (RiskLevel: medium)
- 0–17 = สมรรถภาพสมองบกพร่องรุนแรง (RiskLevel: high, RequiresReferral: true)

---

### SHEET 10: ServiceBenefitReports

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| ReportID | String | ✅ PK | `RPT` + timestamp + random4 |
| PatientID | PatientID FK | ✅ | |
| CarePlanID | CarePlanID FK | | Care Plan ที่เชื่อมโยง |
| FiscalYear | Integer | ✅ | ปีงบประมาณ ค.ศ. | 
| ReportMonth | Integer | ✅ | 1-12 |
| ReportPeriod | String | AUTO | Generated: `{FY}-{MM}` เช่น `2026-10` |
| ServiceItems | JSON String | ✅ | Array ของ service items ที่ให้ |
| TotalServicesProvided | Integer | AUTO | นับจาก ServiceItems |
| TotalVisitsThisMonth | Integer | | จำนวนครั้งที่เยี่ยมเดือนนี้ |
| ReportStatus | Enum | ✅ | draft / submitted / approved |
| ReportedBy | UserID FK | ✅ | CG/CM ที่รายงาน |
| SubmittedAt | ISO DateTime | | วันที่ submit |
| ApprovedBy | UserID FK | | CM ที่อนุมัติ |
| ApprovedAt | ISO DateTime | | |
| Notes | String | | |
| CreatedAt | ISO DateTime | ✅ | |
| UpdatedAt | ISO DateTime | | |

**ServiceItems JSON Structure:**
```json
[
  {"id": "B01", "name": "การประเมินและวางแผนการดูแล", "group": "การดูแลพื้นฐาน", "provided": true},
  {"id": "B02", "name": "การตรวจวัดสัญญาณชีพ", "group": "การดูแลพื้นฐาน", "provided": true}
]
```

---

### SHEET 11: Photos

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| PhotoID | String | ✅ PK | `PHO` + timestamp + random4 |
| PatientID | PatientID FK | ✅ | |
| VisitID | VisitID FK | | (optional, ถ้าผูกกับ Visit ใด) |
| DriveFileID | String | ✅ | Google Drive File ID |
| DriveURL | String | ✅ | Full URL ของไฟล์ |
| ThumbnailURL | String | | URL รูป thumbnail (400px) |
| FileName | String | | ชื่อไฟล์ดั้งเดิม |
| FileSize | Integer | | ขนาดไฟล์ (bytes) |
| MimeType | String | | image/jpeg / image/png |
| Caption | String | | คำบรรยายรูป |
| PhotoCategory | Enum | | visit / wound / environment / equipment / other |
| UploadedBy | UserID FK | ✅ | |
| UploadedDate | Date (yyyy-MM-dd) | ✅ | |
| IsActive | Boolean | ✅ | true = ยังใช้งาน, false = ลบแล้ว |
| CreatedAt | ISO DateTime | ✅ | |

---

### SHEET 12: AuditLogs

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| LogID | String | ✅ PK | `LOG` + timestamp + random4 |
| Timestamp | ISO DateTime | ✅ | เวลาที่เกิดเหตุการณ์ |
| UserID | UserID FK | ✅ | ผู้ดำเนินการ |
| Username | String | ✅ | (denormalized) |
| Action | Enum | ✅ | LOGIN/LOGOUT/CREATE/READ/UPDATE/DELETE/EXPORT/SEND_LINE/APPROVE/SETUP |
| EntityType | String | | Patient/Visit/ADL/CarePlan/User/Setting/Photo/BenefitReport |
| EntityID | String | | Primary Key ของ record ที่ถูกดำเนินการ |
| Details | String | | รายละเอียดเพิ่มเติม |
| Result | Enum | ✅ | success / failed |
| ErrorMessage | String | | ข้อความ error (ถ้า failed) |

> ไม่เก็บ OldValue/NewValue เพื่อลด Sheet size — ใช้เพื่อ traceability เท่านั้น

---

### SHEET 13: Notifications

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| NotificationID | String | ✅ PK | `NTF` + timestamp + random4 |
| PatientID | PatientID FK | | (optional) |
| VisitID | VisitID FK | | (optional) |
| NotificationType | Enum | ✅ | FOLLOW_UP / VISIT_DUE / OVERDUE / LINE_ALERT / SYSTEM |
| Title | String | ✅ | หัวข้อการแจ้งเตือน |
| Message | String | ✅ | ข้อความ |
| Channel | Enum | ✅ | LINE / IN_APP |
| RecipientUserID | UserID FK | | ผู้รับ (ถ้าส่งเฉพาะคน) |
| ScheduledAt | ISO DateTime | | วันเวลาที่กำหนดให้ส่ง |
| SentAt | ISO DateTime | | วันเวลาที่ส่งจริง |
| Status | Enum | ✅ | pending / sent / failed / cancelled |
| LineStatusCode | Integer | | HTTP status จาก LINE API (200=ok) |
| LineResponse | String | | Response body จาก LINE API |
| CreatedBy | UserID FK | ✅ | |
| CreatedAt | ISO DateTime | ✅ | |

---

## 5. USER ROLE & PERMISSION MATRIX

### Legend: ✅ Full | 🔶 Limited | ❌ None

| Feature | admin | cm | cg | viewer |
|---------|-------|----|----|--------|
| **Dashboard** | | | | |
| View all patients stats | ✅ | ✅ | ❌ | ✅ |
| View own patients only | ✅ | ✅ | ✅ | ❌ |
| Follow-up alert list | ✅ | ✅ | ✅ (own) | ❌ |
| **Patients** | | | | |
| Add Patient | ✅ | ✅ | ❌ | ❌ |
| Edit Patient | ✅ | ✅ | ❌ | ❌ |
| Delete Patient (soft) | ✅ | ❌ | ❌ | ❌ |
| View Patient (all) | ✅ | ✅ | ❌ | ✅ |
| View Patient (assigned only) | ✅ | ✅ | ✅ | ❌ |
| View masked CID | ✅ (masked) | ✅ (masked) | ✅ (masked) | ✅ (masked) |
| **CarePlans** | | | | |
| Create CarePlan | ✅ | ✅ | ❌ | ❌ |
| Edit CarePlan | ✅ | ✅ | ❌ | ❌ |
| Approve CarePlan | ✅ | ✅ | ❌ | ❌ |
| View CarePlan | ✅ | ✅ | ✅ (own) | ✅ |
| **Visits** | | | | |
| Create Visit | ✅ | ✅ | ✅ (own patients) | ❌ |
| Edit Visit | ✅ | ✅ | ✅ (own, same day) | ❌ |
| Delete Visit | ✅ | ❌ | ❌ | ❌ |
| View Visit | ✅ | ✅ | ✅ (own) | ✅ |
| **VitalSigns** | | | | |
| Record Vitals | ✅ | ✅ | ✅ | ❌ |
| View Vitals | ✅ | ✅ | ✅ (own) | ✅ |
| **ADL Assessments** | | | | |
| Record ADL | ✅ | ✅ | ✅ | ❌ |
| View ADL | ✅ | ✅ | ✅ (own) | ✅ |
| **PPSA Assessments** | | | | |
| Record PPS | ✅ | ✅ | ✅ | ❌ |
| View PPS | ✅ | ✅ | ✅ (own) | ✅ |
| **Mental Health** | | | | |
| Record Mental Health | ✅ | ✅ | ✅ | ❌ |
| View Mental Health | ✅ | ✅ | ✅ (own) | ✅ |
| **Service Benefits** | | | | |
| Record Benefit Report | ✅ | ✅ | ✅ | ❌ |
| Submit/Approve Report | ✅ | ✅ | ❌ | ❌ |
| View Benefit Report | ✅ | ✅ | ✅ (own) | ✅ |
| **Photos** | | | | |
| Upload Photo | ✅ | ✅ | ✅ | ❌ |
| Delete Photo | ✅ | ✅ | ❌ | ❌ |
| View Photos | ✅ | ✅ | ✅ (own) | ✅ |
| **Reports** | | | | |
| View Patient Report | ✅ | ✅ | ❌ | ✅ |
| View Benefit Report | ✅ | ✅ | ❌ | ✅ |
| Export CSV | ✅ | ✅ | ❌ | ❌ |
| View Audit Log | ✅ | ❌ | ❌ | ❌ |
| **Notifications** | | | | |
| Send LINE Notify | ✅ | ✅ | ❌ | ❌ |
| View LINE Log | ✅ | ✅ | ❌ | ❌ |
| Setup Auto Trigger | ✅ | ❌ | ❌ | ❌ |
| **Settings** | | | | |
| Org Settings | ✅ | ❌ | ❌ | ❌ |
| User Management | ✅ | ❌ | ❌ | ❌ |
| LINE Token | ✅ | ❌ | ❌ | ❌ |
| Benefit Items Config | ✅ | ❌ | ❌ | ❌ |
| Change own password | ✅ | ✅ | ✅ | ✅ |

---

## 6. REQUIRED API LIST

### Auth APIs (Users.gs)
| Function | Params | Returns | Auth |
|----------|--------|---------|------|
| `login(username, password)` | string, string | `{ok, token, user}` | ❌ |
| `logout(token)` | string | `{ok}` | token |
| `loadInitialBundle(token)` | string | `{ok, user, settings, patients, caregivers, benefitItems}` | token |
| `logClientError(payload)` | object | void | ❌ |

### User Management APIs (Users.gs)
| Function | Params | Returns | Roles |
|----------|--------|---------|-------|
| `getUsers(token)` | token | `{ok, data}` | admin |
| `createUser(token, payload)` | token, object | `{ok, userId}` | admin |
| `updateUser(token, targetId, payload)` | token, string, object | `{ok}` | admin / self |
| `deleteUser(token, targetId)` | token, string | `{ok}` | admin |
| `saveSettings(token, obj)` | token, object | `{ok}` | admin |

### Patient APIs (Patients.gs)
| Function | Params | Returns | Roles |
|----------|--------|---------|-------|
| `getPatients(token, filters)` | token, object | `{ok, data}` | all |
| `getPatientDetail(token, patientId)` | token, string | `{ok, data}` | all |
| `addPatient(token, payload)` | token, object | `{ok, patientId}` | admin, cm |
| `updatePatient(token, patientId, payload)` | token, string, object | `{ok}` | admin, cm |
| `deletePatient(token, patientId)` | token, string | `{ok}` | admin |
| `uploadPhoto(token, patientId, visitId, base64, mimeType, caption, category)` | ... | `{ok, photoId, driveUrl}` | admin, cm, cg |
| `deletePhoto(token, photoId)` | token, string | `{ok}` | admin, cm |

### CarePlan APIs (CarePlans.gs)
| Function | Params | Returns | Roles |
|----------|--------|---------|-------|
| `getCarePlans(token, patientId)` | token, string | `{ok, data}` | all |
| `saveCarePlan(token, payload)` | token, object | `{ok, carePlanId}` | admin, cm |
| `updateCarePlan(token, carePlanId, payload)` | token, string, object | `{ok}` | admin, cm |
| `approveCarePlan(token, carePlanId)` | token, string | `{ok}` | admin, cm |

### Visit APIs (Visits.gs)
| Function | Params | Returns | Roles |
|----------|--------|---------|-------|
| `createVisit(token, payload)` | token, object | `{ok, visitId, visitNo}` | admin, cm, cg |
| `updateVisit(token, visitId, payload)` | token, string, object | `{ok}` | admin, cm, cg |
| `getVisits(token, patientId, limit)` | token, string, number | `{ok, data}` | all |
| `getVisitDetail(token, visitId)` | token, string | `{ok, data}` | all |

### Screening APIs (Screening.gs)
| Function | Params | Returns | Roles |
|----------|--------|---------|-------|
| `saveVitalSigns(token, payload)` | token, object | `{ok, vitalId, bmi}` | admin, cm, cg |
| `getVitalSigns(token, patientId, limit)` | token, string, number | `{ok, data}` | all |
| `saveADL(token, payload)` | token, object | `{ok, adlId, total, level}` | admin, cm, cg |
| `getADL(token, patientId, limit)` | token, string, number | `{ok, data}` | all |
| `savePPS(token, payload)` | token, object | `{ok, ppsaId, score, level}` | admin, cm, cg |
| `getPPS(token, patientId, limit)` | token, string, number | `{ok, data}` | all |
| `saveMentalHealth(token, payload)` | token, object | `{ok, screeningId, total, level}` | admin, cm, cg |
| `getMentalHealth(token, patientId, type)` | token, string, string | `{ok, data}` | all |
| `getScreeningMeta(token)` | token | `{ok, adlItems, tgdsItems, ppsLevels}` | all |

### Benefit Report APIs (BenefitPackage.gs)
| Function | Params | Returns | Roles |
|----------|--------|---------|-------|
| `saveBenefitReport(token, payload)` | token, object | `{ok, reportId}` | admin, cm, cg |
| `submitBenefitReport(token, reportId)` | token, string | `{ok}` | admin, cm |
| `approveBenefitReport(token, reportId)` | token, string | `{ok}` | admin, cm |
| `getBenefitReports(token, patientId, fiscalYear)` | token, string, number | `{ok, data}` | all |
| `getBenefitSummary(token, fiscalYear, month)` | token, number, number | `{ok, data, summary}` | admin, cm |
| `getBenefitItems(token)` | token | `{ok, items}` | all |

### Dashboard & Report APIs (Dashboard.gs / Reports.gs)
| Function | Params | Returns | Roles |
|----------|--------|---------|-------|
| `getDashboardData(token)` | token | `{ok, stats, charts, followUpList}` | all |
| `getCareOutcome(token, patientId)` | token, string | `{ok, adlTrend, ppsTrend, vitalHistory}` | all |
| `getPatientReport(token, filters)` | token, object | `{ok, data}` | admin, cm, viewer |
| `getBenefitMonthlyReport(token, fy, month)` | token, number, number | `{ok, data, summary}` | admin, cm |
| `getAuditLog(token, limit)` | token, number | `{ok, data}` | admin |

### Notification APIs (LineNotify.gs)
| Function | Params | Returns | Roles |
|----------|--------|---------|-------|
| `sendLineNotify(token, patientId, type, message)` | token, string, string, string | `{ok}` | admin, cm |
| `getNotifications(token, filters)` | token, object | `{ok, data}` | admin, cm |
| `setupDailyTrigger()` | - | void | (triggered manually by admin) |
| `sendFollowUpAlerts()` | - | void | (time-based trigger) |

---

## 7. UI PAGE LIST

| # | Page Name | Path (view value) | Description | Roles |
|---|-----------|------------------|-------------|-------|
| 1 | **Login** | (unauthenticated) | หน้า Login ด้วย username/password | all (unauth) |
| 2 | **Dashboard** | `dashboard` | สรุปสถิติ, แผนภูมิ, Follow-up list | all |
| 3 | **Patient List** | `patients` | ตารางผู้ป่วย + ค้นหา/กรอง | all |
| 4 | **Patient Detail** | `patients` → detail | ข้อมูลผู้ป่วย + Tabs (8 tabs) | all |
| 5 | **Patient Form** | (modal) | เพิ่ม/แก้ไขผู้ป่วย | admin, cm |
| 6 | **Visit Form** | (modal/inline) | สร้างการเยี่ยมใหม่ | admin, cm, cg |
| 7 | **Care Plan Form** | (modal) | สร้าง/แก้ไข Care Plan | admin, cm |
| 8 | **Screening Forms** | `screening` | แบบประเมิน Vitals/ADL/PPS/Mental | admin, cm, cg |
| 9 | **Benefit Report Form** | `benefit` | รายงานบริการ LTC รายเดือน | admin, cm, cg |
| 10 | **Reports** | `reports` | รายงาน 5 ประเภท + Export CSV | admin, cm, viewer |
| 11 | **Settings** | `settings` | Org/Users/LINE/Benefits/Profile | varies |
| 12 | **Notifications** | `notifications` | ดูประวัติและส่ง LINE Notify | admin, cm |

### Patient Detail Tabs
| Tab | เนื้อหา |
|-----|---------|
| 📋 ข้อมูลผู้ป่วย | ข้อมูลส่วนตัว, ที่อยู่, CID (masked) |
| 🏥 การเยี่ยม | Visit list พร้อม VisitNo, สร้าง Visit ใหม่ |
| 💓 สัญญาณชีพ | ประวัติ Vital Signs + กราฟ trend |
| 🧩 ADL | ประวัติ Barthel Index + trend |
| 📊 PPS | ประวัติ PPS + care category |
| 🧠 สุขภาพจิต | ประวัติ TGDS/TMSE |
| ✅ บริการ LTC | ServiceBenefitReports รายเดือน |
| 📷 รูปภาพ | Photo gallery + upload |
| 🗺️ แผนที่ | Leaflet map แสดงบ้านผู้ป่วย |
| 📈 ผลลัพธ์ | Care Outcome Analysis (ADL/PPS trend) |

---

## 8. DATA RELATIONSHIPS

```
┌─────────────────────────────────────────────────────────────────┐
│                        Setting (1)                              │
│                    (ไม่ relate กับ entity อื่น)                 │
└─────────────────────────────────────────────────────────────────┘

┌───────────────────┐
│     Users (N)     │◄──────────────────────────────────┐
│  UserID (PK)      │                                   │
│  Role             │  CreatedBy / AssignedCgID /       │
└──────────┬────────┘  AssignedCmID / RecordedBy /      │
           │           AssessedBy / ReportedBy          │
           │                                            │
           │ (1:N via AssignedCgID / AssignedCmID)      │
           ▼                                            │
┌───────────────────────────────────┐                  │
│          Patients (N)             │──────────────────►│
│  PatientID (PK)                   │                   │
│  CareLevel                        │                   │
│  AssignedCgID → Users             │                   │
│  AssignedCmID → Users             │                   │
│  ActiveCarePlanID → CarePlans     │                   │
└──────┬───────────┬────────────────┘                   │
       │           │                                    │
       │ (1:N)     │ (1:N)                              │
       ▼           ▼                                    │
┌──────────┐  ┌─────────────────┐                      │
│CarePlans │  │   Visits (N)    │                      │
│(N)       │  │  VisitID (PK)   │                      │
│CarePlanID│  │  PatientID (FK) │                      │
│PatientID │  │  VisitNo (AUTO) │◄─────────────────────│
│(FK)      │  │  CarePlanID(FK) │                      │
└──────────┘  └────┬────────────┘                      │
                   │                                   │
         ┌─────────┼─────────────────────┐            │
         │         │         │           │            │
         ▼         ▼         ▼           ▼            │
  ┌──────────┐ ┌──────┐ ┌──────┐  ┌──────────┐       │
  │VitalSigns│ │ADL   │ │PPSA  │  │Mental    │       │
  │          │ │Assess│ │Assess│  │Health    │       │
  │VisitID FK│ │ments │ │ments │  │Screenings│       │
  │PatientID │ │VisiID│ │VisiID│  │VisitID FK│       │
  └──────────┘ └──────┘ └──────┘  └──────────┘       │
                                                      │
  ┌────────────────────────────────────────┐          │
  │      ServiceBenefitReports (N)         │          │
  │  PatientID (FK)  CarePlanID (FK)       │──────────►
  │  FiscalYear + ReportMonth (UNIQUE pair)│
  └────────────────────────────────────────┘

  ┌──────────────────────┐
  │      Photos (N)       │
  │  PatientID (FK)       │
  │  VisitID (FK, opt)    │
  └──────────────────────┘

  ┌──────────────────────────────────────┐
  │          AuditLogs (N)               │
  │  UserID (FK)                         │
  │  EntityType + EntityID (any entity)  │
  └──────────────────────────────────────┘

  ┌──────────────────────────────────────┐
  │        Notifications (N)             │
  │  PatientID (FK, opt)                 │
  │  VisitID (FK, opt)                   │
  │  RecipientUserID (FK, opt)           │
  └──────────────────────────────────────┘
```

### Primary Key Format Summary

| Sheet | PK Prefix | Format | Example |
|-------|-----------|--------|---------|
| Users | `USR` | USR + Date.now() + random4 | `USR17196001234567` |
| Patients | `PT` | PT + Date.now() + random4 | `PT17196001234567` |
| CarePlans | `CP` | CP + Date.now() + random4 | `CP17196001234567` |
| Visits | `VT` | VT + Date.now() + random4 | `VT17196001234567` |
| VitalSigns | `VS` | VS + Date.now() + random4 | `VS17196001234567` |
| ADLAssessments | `ADL` | ADL + Date.now() + random4 | `ADL17196001234` |
| PPSAAssessments | `PPSA` | PPSA + Date.now() + random4 | `PPSA1719600123` |
| MentalHealthScreenings | `MH` | MH + Date.now() + random4 | `MH17196001234567` |
| ServiceBenefitReports | `RPT` | RPT + Date.now() + random4 | `RPT17196001234` |
| Photos | `PHO` | PHO + Date.now() + random4 | `PHO17196001234` |
| AuditLogs | `LOG` | LOG + Date.now() + random4 | `LOG17196001234` |
| Notifications | `NTF` | NTF + Date.now() + random4 | `NTF17196001234` |

### VisitNo Auto-Calculation Logic
```javascript
// ใน createVisit() — ต้องใช้ LockService ป้องกัน race condition
function createVisit_(patientId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const visits = readSheet_('Visits').filter(v => v.PatientID === patientId);
    const visitNo = visits.length + 1;
    // ... append row with VisitNo = visitNo
    return visitNo;
  } finally {
    lock.releaseLock();
  }
}
```

### CID Masking Logic
```javascript
// Server: เก็บ CID เต็ม ใน Sheet
// Client: แสดงแบบ mask เสมอ ไม่ส่ง CID เต็มไปที่ client ยกเว้น admin
function maskCID_(cid) {
  if (!cid) return '-';
  const s = String(cid).replace(/\D/g,'');
  if (s.length !== 13) return '***masked***';
  return `X-XXXX-XXXXX-XX-${s.slice(-1)}`; // แสดงแค่ตัวสุดท้าย
  // หรือ: return `*****${s.slice(-4)}` // แสดง 4 ตัวท้าย
}

// ใน sanitize_() ต้อง mask CID ก่อนส่ง client
function sanitizeForClient_(obj) {
  const out = { ...obj };
  if (out.CID) out.CID = maskCID_(out.CID);
  // ... remove sensitive fields
  delete out.PasswordHash;
  delete out.PasswordSalt;
  delete out.__rowIndex;
  return out;
}
```

### Date Handling Rules
```javascript
// Sheet → เก็บเป็น string "yyyy-MM-dd" (ตั้ง column format = Plain text)
// UI → แสดงเป็น "dd/MM/yyyy" พ.ศ. (CE + 543)
// Server → serialize Date object เป็น ISO string ก่อนส่ง client

function toThaiDate_(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr).split('T')[0];
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear() + 543;
  return `${day}/${month}/${year}`;
}
```

---

## 9. ADDITIONAL DESIGN DECISIONS

### PDPA Compliance
1. CID ไม่เคยส่งออกไปที่ client แบบ plain text — mask เสมอ
2. ผู้ดูแล (cg) เห็นเฉพาะผู้ป่วยที่ได้รับมอบหมาย
3. ข้อมูลสุขภาพเข้าถึงได้เฉพาะผู้มีสิทธิ์
4. Audit Log บันทึกทุก action ที่กระทบข้อมูลส่วนบุคคล
5. ไม่ log OldValue/NewValue ที่มี sensitive data

### Performance Considerations
1. `loadInitialBundle()` — 1 RPC call แทน 5 ลด latency
2. CacheService เก็บ session token (ไม่ใช่ Sheet)
3. `readSheet_()` bulk read ทุกครั้ง (1 round-trip)
4. ไม่ใช้ computed column ใน Sheet — คำนวณใน GAS
5. รูปภาพ compress เป็น JPEG 82% ขนาด max 1200px ก่อน upload

### Text Fields (ต้องตั้ง column format = @ / Plain text)
- CID, Phone, HN, PostalCode, VillageNo, EmergencyContactPhone, UserID fields

### Unique Constraints (enforce ใน GAS)
- `Users.Username` — ต้อง unique
- `ServiceBenefitReports.(PatientID + FiscalYear + ReportMonth)` — ต้อง unique (update แทน insert ถ้ามีซ้ำ)

---

*Document Version: 1.0 | Ready for Phase 2 Coding*
