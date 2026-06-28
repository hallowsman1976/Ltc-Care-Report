/**
 * ============================================================
 * LTC Care Report - Code.gs (Entry Point + Schema Bootstrap)
 * ============================================================
 * ระบบรายงานการดูแลผู้สูงอายุและผู้ที่มีภาวะพึ่งพิง
 * NHSO LTC Benefit Package - ระดับตำบล
 * Phase 2: Backend Core
 * ============================================================
 */

// ── ค่าคงที่ระบบ ────────────────────────────────────────────
const APP_NAME = 'LTC Care Report';
const APP_VERSION = '2.0.0';
const SESSION_CACHE_KEY_PREFIX = 'ltc_session_';
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 ชั่วโมง

// ── ชื่อ Sheet ทั้ง 13 ตาราง ──────────────────────────────
const SHEET_NAMES = {
  SETTING:        'Setting',
  USERS:          'Users',
  PATIENTS:       'Patients',
  CARE_PLANS:     'CarePlans',
  VISITS:         'Visits',
  VITAL_SIGNS:    'VitalSigns',
  ADL:            'ADLAssessments',
  PPSA:           'PPSAAssessments',
  MENTAL_HEALTH:  'MentalHealthScreenings',
  BENEFIT_REPORT: 'ServiceBenefitReports',
  PHOTOS:         'Photos',
  AUDIT_LOG:      'AuditLogs',
  NOTIFICATION:   'Notifications',
};

// ── คอลัมน์ที่ต้องเป็น Plain Text (กัน 0 นำหน้าหาย) ────
const TEXT_COLUMNS = [
  'CID', 'Phone', 'HN', 'PostalCode', 'VillageNo',
  'EmergencyContactPhone', 'LineUserID',
];

// ── Schema ของแต่ละ Sheet ────────────────────────────────
const SHEET_SCHEMA = {
  [SHEET_NAMES.SETTING]: [
    'SettingKey','SettingValue','DataType','Description','UpdatedAt','UpdatedBy'
  ],
  [SHEET_NAMES.USERS]: [
    'UserID','Username','PasswordHash','PasswordSalt','FullName','NickName',
    'Role','Phone','Email','OrgName','IsActive','CreatedAt','UpdatedAt',
    'LastLoginAt','CreatedBy'
  ],
  [SHEET_NAMES.PATIENTS]: [
    'PatientID','CID','HN','FullName','Sex','BirthDate','Age','Phone',
    'Address','VillageNo','VillageName','Subdistrict','District','Province',
    'Latitude','Longitude','MainCaregiverName','MainCaregiverPhone','Relationship',
    'RightType','Disease','DependencyStatus','ADLScore','TAIGroup','PPSScore',
    'MentalHealthStatus','CareManagerID','CaregiverID','RegisterDate','Status',
    'CreatedBy','CreatedAt','UpdatedAt'
  ],
  [SHEET_NAMES.CARE_PLANS]: [
    'CarePlanID','PatientID','PlanDate','ProblemList','GoalOfCare','ServicePackage',
    'FrequencyPerMonth','EquipmentNeed','ReferralNeed','BudgetAmount',
    'StartDate','EndDate','ApprovedBy','ApprovedDate','PlanStatus',
    'CreatedBy','CreatedAt','UpdatedAt'
  ],
  [SHEET_NAMES.VISITS]: [
    'VisitID','PatientID','VisitNo','VisitDate','StartTime','EndTime',
    'VisitorID','VisitorName','VisitType','MainProblem','CareProvided',
    'HealthEducation','FamilyParticipation','EnvironmentIssue','MedicationIssue',
    'NutritionIssue','RehabilitationIssue','PsychosocialIssue','ReferralAction',
    'NextVisitDate','VisitSummary','PhotoURLs','Latitude','Longitude',
    'CreatedAt','UpdatedAt','CreatedBy'
  ],
  [SHEET_NAMES.VITAL_SIGNS]: [
    'VitalID','VisitID','PatientID','VisitDate','Weight','Height','BMI',
    'BMIInterpretation','Temperature','Pulse','RespiratoryRate','SBP','DBP',
    'BPInterpretation','DTX','DTXInterpretation','PainScore','OxygenSat','CreatedAt'
  ],
  [SHEET_NAMES.ADL]: [
    'ADLID','PatientID','VisitID','AssessmentDate',
    'Feeding','Grooming','Transfer','ToiletUse','Mobility','Dressing','Stairs',
    'Bathing','Bowels','Bladder',
    'TotalADL','DependencyLevel','TAIGroup','AssessorID','CreatedAt'
  ],
  [SHEET_NAMES.PPSA]: [
    'PPSID','PatientID','VisitID','AssessmentDate',
    'Ambulation','ActivityDisease','SelfCare','Intake','ConsciousLevel',
    'PPSScore','Interpretation','PalliativeFlag','AssessorID','CreatedAt'
  ],
  [SHEET_NAMES.MENTAL_HEALTH]: [
    'MHID','PatientID','VisitID','AssessmentDate','ScreeningType',
    'Q1','Q2','Q3','Q4','Q5','Q6','Q7','Q8','Q9',
    'TotalScore','Result','RiskLevel','Recommendation','AssessorID','CreatedAt'
  ],
  [SHEET_NAMES.BENEFIT_REPORT]: [
    'ReportID','PatientID','CarePlanID','FiscalYear','ReportMonth','ReportPeriod',
    'ServiceItems','TotalServicesProvided','TotalVisitsThisMonth','ReportStatus',
    'ReportedBy','SubmittedAt','ApprovedBy','ApprovedAt','Notes','CreatedAt','UpdatedAt'
  ],
  [SHEET_NAMES.PHOTOS]: [
    'PhotoID','PatientID','VisitID','DriveFileID','DriveURL','ThumbnailURL',
    'FileName','FileSize','MimeType','Caption','PhotoCategory',
    'UploadedBy','UploadedDate','IsActive','CreatedAt'
  ],
  [SHEET_NAMES.AUDIT_LOG]: [
    'LogID','Timestamp','UserID','Username','Action','EntityType','EntityID',
    'Details','OldValue','NewValue','Result','ErrorMessage','IPAddress'
  ],
  [SHEET_NAMES.NOTIFICATION]: [
    'NotificationID','PatientID','VisitID','NotificationType','Title','Message',
    'Channel','RecipientUserID','ScheduledAt','SentAt','Status',
    'LineStatusCode','LineResponse','CreatedBy','CreatedAt'
  ],
};

// ── Default Settings (สร้างตอน setup) ────────────────────
const DEFAULT_SETTINGS = [
  { key:'ORG_NAME',             value:'อบต./เทศบาล',                  type:'text',    desc:'ชื่อองค์กร' },
  { key:'ORG_CODE',             value:'',                              type:'text',    desc:'รหัส อปท.' },
  { key:'ORG_SUBDISTRICT',      value:'',                              type:'text',    desc:'ตำบล' },
  { key:'ORG_DISTRICT',         value:'',                              type:'text',    desc:'อำเภอ' },
  { key:'ORG_PROVINCE',         value:'',                              type:'text',    desc:'จังหวัด' },
  { key:'FISCAL_YEAR',          value:String(new Date().getFullYear()),type:'number',  desc:'ปีงบประมาณ (ค.ศ.)' },
  { key:'LTC_BUDGET_PER_PERSON',value:'5000',                          type:'number',  desc:'งบ LTC ต่อราย (บาท/ปี)' },
  { key:'LINE_NOTIFY_TOKEN',    value:'',                              type:'text',    desc:'LINE Notify Token' },
  { key:'MAP_DEFAULT_LAT',      value:'13.736717',                     type:'number',  desc:'Latitude เริ่มต้น' },
  { key:'MAP_DEFAULT_LNG',      value:'100.523186',                    type:'number',  desc:'Longitude เริ่มต้น' },
  { key:'APP_VERSION',          value:APP_VERSION,                     type:'text',    desc:'เวอร์ชันระบบ' },
  // ── Phase 7: Map / Photo / LINE Messaging / Report ──
  { key:'APP_NAME',                 value:APP_NAME,   type:'text',   desc:'ชื่อแอปพลิเคชัน' },
  { key:'WEBAPP_URL',               value:'',         type:'text',   desc:'URL ของ Web App (สำหรับลิงก์ในข้อความแจ้งเตือน)' },
  { key:'DRIVE_FOLDER_LTC_PHOTO',   value:'',         type:'text',   desc:'Google Drive Folder ID สำหรับเก็บรูปภาพ' },
  { key:'LINE_CHANNEL_ACCESS_TOKEN',value:'',         type:'text',   desc:'LINE Messaging API Channel Access Token' },
  { key:'LINE_GROUP_ID',            value:'',         type:'text',   desc:'LINE Group/User ID ปลายทางการแจ้งเตือน' },
  { key:'LTC_BUDGET_PER_PERSON_YEAR', value:'5000',   type:'number', desc:'งบ LTC ต่อราย/ปี (บาท)' },
  { key:'DISTRICT_NAME',            value:'',         type:'text',   desc:'ชื่ออำเภอ' },
  { key:'SUBDISTRICT_NAME',         value:'',         type:'text',   desc:'ชื่อตำบล' },
];

// ── Permission Matrix ────────────────────────────────────
// รูปแบบ: { role: { module: ['action1','action2',...] } }
// action: read, create, update, delete, approve, export
const PERMISSION_MATRIX = {
  admin: {
    patient:        ['read','create','update','delete'],
    careplan:       ['read','create','update','delete','approve'],
    visit:          ['read','create','update','delete'],
    screening:      ['read','create','update','delete'],
    benefit:        ['read','create','update','delete','approve'],
    photo:          ['read','create','update','delete'],
    report:         ['read','export'],
    audit:          ['read','export'],
    user:           ['read','create','update','delete'],
    setting:        ['read','update'],
    notification:   ['read','create'],
  },
  cm: {
    patient:        ['read','create','update'],
    careplan:       ['read','create','update','approve'],
    visit:          ['read','create','update'],
    screening:      ['read','create','update'],
    benefit:        ['read','create','update','approve'],
    photo:          ['read','create','delete'],
    report:         ['read','export'],
    audit:          [],
    user:           [],
    setting:        [],
    notification:   ['read','create'],
  },
  cg: {
    patient:        ['read'],
    careplan:       ['read'],
    visit:          ['read','create','update'],
    screening:      ['read','create'],
    benefit:        ['read','create'],
    photo:          ['read','create'],
    report:         [],
    audit:          [],
    user:           [],
    setting:        [],
    notification:   [],
  },
  viewer: {
    patient:        ['read'],
    careplan:       ['read'],
    visit:          ['read'],
    screening:      ['read'],
    benefit:        ['read'],
    photo:          ['read'],
    report:         ['read'],
    audit:          [],
    user:           [],
    setting:        [],
    notification:   [],
  },
};

/**
 * doGet(e) — Entry point ของ Web App
 * เสิร์ฟ Index.html เป็น SPA shell
 */
function doGet(e) {
  try {
    // ── REST GET: ถ้ามี ?action= ให้ตอบ JSON แทนการเสิร์ฟหน้าเว็บ ──
    const restOut = _restGetIfApi_(e);
    if (restOut) return restOut;

    return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle(APP_NAME)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    Logger.log('doGet error: ' + err);
    return HtmlService.createHtmlOutput(
      '<h2 style="font-family:sans-serif;color:#dc2626;padding:24px">' +
      'เกิดข้อผิดพลาดในการโหลดระบบ: ' + err.message + '</h2>'
    );
  }
}

/**
 * include(filename) — ใช้ใน Template เพื่อ embed HTML/CSS/JS partial
 * เช่น <?!= include('Styles') ?>
 */
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (err) {
    Logger.log('include() failed for ' + filename + ': ' + err);
    return '<!-- include failed: ' + filename + ' -->';
  }
}

/**
 * setupSheets() — สร้าง 13 Sheet พร้อม Header + Admin user เริ่มต้น
 * เรียกครั้งเดียวตอน Setup โปรเจ็ค หรือเรียกใหม่เพื่อ Migrate
 * @returns {Object} { success, data, message }
 */
function setupSheets() {
  try {
    const ss = SpreadsheetApp.getActive();
    const created = [];
    const updated = [];

    // ── 1. สร้าง Sheet ทั้งหมด + Header ──
    Object.entries(SHEET_SCHEMA).forEach(([sheetName, headers]) => {
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        created.push(sheetName);
      } else {
        updated.push(sheetName);
      }
      _writeHeaders_(sheet, headers);
      _applyTextFormatToColumns_(sheet, headers);
    });

    // ── 2. ลบ Sheet "Sheet1" default ถ้ายังมี ──
    const def = ss.getSheetByName('Sheet1');
    if (def && ss.getSheets().length > 1) {
      try { ss.deleteSheet(def); } catch(e){}
    }

    // ── 3. สร้าง Default Settings (ถ้ายังไม่มี) ──
    const settingSheet = ss.getSheetByName(SHEET_NAMES.SETTING);
    const existingKeys = _readSheetAsObjects_(settingSheet).map(r => r.SettingKey);
    DEFAULT_SETTINGS.forEach(s => {
      if (!existingKeys.includes(s.key)) {
        settingSheet.appendRow([s.key, s.value, s.type, s.desc, new Date().toISOString(), 'SYSTEM']);
      }
    });

    // ── 4. สร้าง Admin User เริ่มต้น (ถ้ายังไม่มี) ──
    const userSheet = ss.getSheetByName(SHEET_NAMES.USERS);
    const existingUsers = _readSheetAsObjects_(userSheet);
    const hasAdmin = existingUsers.some(u => u.Username === 'admin');

    if (!hasAdmin) {
      const salt = Utilities.getUuid();
      const hash = _computeHash_('admin123', salt);
      const adminId = generateId('USR');
      const now = new Date().toISOString();
      userSheet.appendRow([
        adminId,         // UserID
        'admin',         // Username
        hash,            // PasswordHash
        salt,            // PasswordSalt
        'ผู้ดูแลระบบ',   // FullName
        'Admin',         // NickName
        'admin',         // Role
        '',              // Phone
        '',              // Email
        '',              // OrgName
        true,            // IsActive
        now,             // CreatedAt
        '',              // UpdatedAt
        '',              // LastLoginAt
        'SYSTEM'         // CreatedBy
      ]);
    }

    return {
      success: true,
      data: { created, updated, hasAdmin: !hasAdmin ? 'created' : 'existing' },
      message: 'ตั้งค่าระบบสำเร็จ สร้าง ' + created.length + ' sheet, ' +
               'มี ' + updated.length + ' sheet เดิม' +
               (!hasAdmin ? ' | สร้าง admin user: admin / admin123' : '')
    };
  } catch (err) {
    Logger.log('setupSheets error: ' + err.stack);
    return { success: false, data: null, message: 'ตั้งค่าระบบไม่สำเร็จ: ' + err.message };
  }
}

/**
 * _writeHeaders_() — เขียน Header row พร้อมจัด format
 * @private
 */
function _writeHeaders_(sheet, headers) {
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold')
       .setBackground('#1e3a5f')
       .setFontColor('#ffffff')
       .setHorizontalAlignment('center')
       .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 32);
}

/**
 * _applyTextFormatToColumns_() — ตั้ง column format = @ (Plain text)
 * สำหรับ column ใน TEXT_COLUMNS เพื่อกัน 0 นำหน้าหาย
 * @private
 */
function _applyTextFormatToColumns_(sheet, headers) {
  headers.forEach((h, idx) => {
    if (TEXT_COLUMNS.includes(h)) {
      sheet.getRange(1, idx + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
    }
  });
}

/**
 * _readSheetAsObjects_() — อ่าน Sheet เป็น Array of Object (private)
 * @private
 */
function _readSheetAsObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

/**
 * _computeHash_() — คำนวณ Password Hash (HMAC-SHA256 x 10,000 รอบ)
 * @private
 */
function _computeHash_(password, salt) {
  let hash = password + salt;
  for (let i = 0; i < 10000; i++) {
    const bytes = Utilities.computeHmacSha256Signature(hash, salt);
    hash = Utilities.base64Encode(bytes);
  }
  return hash;
}

/**
 * onOpen() — เพิ่มเมนูบน Google Sheets toolbar
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('⚙️ LTC Admin')
      .addItem('🔧 ตั้งค่าระบบครั้งแรก (Setup Sheets)', 'menuSetupSheets')
      .addItem('🔄 รีเซ็ต Admin Password', 'menuResetAdminPassword')
      .addSeparator()
      .addItem('🌐 เปิด Web App', 'menuOpenWebApp')
      .addItem('ℹ️ เกี่ยวกับระบบ', 'menuAbout')
      .addToUi();
  } catch(e) {}
}

/** เมนู: เรียก setupSheets() */
function menuSetupSheets() {
  const result = setupSheets();
  SpreadsheetApp.getUi().alert(result.message);
}

/** เมนู: รีเซ็ตรหัส admin เป็น admin123 */
function menuResetAdminPassword() {
  try {
    const ss = SpreadsheetApp.getActive();
    const userSheet = ss.getSheetByName(SHEET_NAMES.USERS);
    const users = _readSheetAsObjects_(userSheet);
    const adminRow = users.findIndex(u => u.Username === 'admin');
    if (adminRow < 0) {
      SpreadsheetApp.getUi().alert('ไม่พบ admin user กรุณาเรียก Setup Sheets ก่อน');
      return;
    }
    const salt = Utilities.getUuid();
    const hash = _computeHash_('admin123', salt);
    const headers = userSheet.getRange(1, 1, 1, userSheet.getLastColumn()).getValues()[0];
    const hashCol = headers.indexOf('PasswordHash') + 1;
    const saltCol = headers.indexOf('PasswordSalt') + 1;
    userSheet.getRange(adminRow + 2, hashCol).setValue(hash);
    userSheet.getRange(adminRow + 2, saltCol).setValue(salt);
    SpreadsheetApp.getUi().alert('รีเซ็ตรหัสผ่าน admin เป็น "admin123" สำเร็จ');
  } catch (err) {
    SpreadsheetApp.getUi().alert('ผิดพลาด: ' + err.message);
  }
}

/** เมนู: แสดง URL ของ Web App */
function menuOpenWebApp() {
  const url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert('Web App URL:\n' + (url || '(ยังไม่ได้ deploy)'));
}

/** เมนู: ข้อมูลระบบ */
function menuAbout() {
  SpreadsheetApp.getUi().alert(
    APP_NAME + ' v' + APP_VERSION + '\n\n' +
    'ระบบรายงานการดูแลผู้สูงอายุและผู้ที่มีภาวะพึ่งพิง\n' +
    'NHSO LTC Benefit Package'
  );
}
