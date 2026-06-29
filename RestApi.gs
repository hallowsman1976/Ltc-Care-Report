/**
 * ============================================================
 * RestApi.gs — HTTP REST Gateway (External-Client Callable)
 * ============================================================
 * ให้ client ภายนอก (มือถือ, เว็บแยก, Postman, n8n, ...) เรียก
 * backend ผ่าน HTTPS + JSON โดยไม่ต้องใช้ google.script.run
 *
 * ── รูปแบบการเรียก ──────────────────────────────────────────
 *  POST  <WEBAPP_URL>            (แนะนำ)
 *    Content-Type: text/plain;charset=utf-8   ← เลี่ยง CORS preflight
 *    Body (JSON string):
 *      { "action": "login", "token": "...", "payload": { ... } }
 *
 *  GET   <WEBAPP_URL>?action=ping&token=...&<payloadKey>=<value>
 *    (ใช้ได้เฉพาะ action ที่ไม่ต้องส่ง object ซับซ้อน)
 *
 * ── รูปแบบ Response (เหมือน api_* เดิม) ──────────────────────
 *    { "success": boolean, "data": any|null, "message": string }
 *
 * ── ข้อจำกัด GAS ที่ต้องรู้ ─────────────────────────────────
 * 1) GAS ตั้ง response header เองไม่ได้ → ตอบ CORS preflight (OPTIONS)
 *    ไม่ได้. Client ข้ามโดเมนต้องส่งเป็น text/plain (simple request)
 *    ถ้าตั้ง Content-Type: application/json browser จะยิง preflight
 *    แล้วล้มเหลว.
 * 2) ต้อง Deploy เป็น Web App + execute as "USER_DEPLOYING" +
 *    access "ANYONE_ANONYMOUS" (ตั้งไว้แล้วใน appsscript.json)
 * 3) ทุกครั้งที่แก้โค้ดต้อง clasp push แล้ว Deploy เวอร์ชันใหม่
 *    (Manage deployments → Edit → New version) ไม่งั้น URL เดิม
 *    ยังรันโค้ดเก่า
 * ============================================================
 */

// ── เปิด/ปิด การบังคับ API Key สำหรับ endpoint สาธารณะ ──
// ถ้าตั้ง Setting key 'REST_API_KEY' ไว้ จะบังคับให้ทุก request
// แนบ apiKey ตรงกัน (กัน abuse). ถ้าไม่ตั้ง = ไม่บังคับ
const REST_API_KEY_SETTING = 'REST_API_KEY';

/**
 * doPost(e) — Entry point สำหรับ REST (JSON body)
 */
function doPost(e) {
  return _restDispatch_(e, 'POST');
}

/**
 * _restGetIfApi_(e) — เรียกจาก doGet ใน Code.gs
 * คืน TextOutput (JSON) ถ้าเป็น REST call, หรือ null ถ้าเป็นการขอหน้าเว็บปกติ
 */
function _restGetIfApi_(e) {
  if (e && e.parameter && e.parameter.action) {
    return _restDispatch_(e, 'GET');
  }
  return null;
}

/**
 * _restDispatch_(e, method) — แกนกลาง: parse → auth gate → route → JSON out
 * @private
 */
function _restDispatch_(e, method) {
  try {
    const body = _restParseBody_(e, method);
    const action = body.action;

    if (!action) {
      return _restJson_(errResult('ไม่ได้ระบุ action'), 400);
    }

    const route = REST_ROUTES[action];
    if (!route) {
      return _restJson_(errResult('ไม่รู้จัก action: ' + action), 404);
    }

    // ── API Key gate (เฉพาะ action ที่ public = true และระบบตั้ง key ไว้) ──
    const keyError = _restCheckApiKey_(body, route);
    if (keyError) return _restJson_(keyError, 401);

    // ── เรียก handler (handler จัดการ auth/permission เองผ่าน token) ──
    const result = route.handler(body, e);
    return _restJson_(result, result && result.success === false ? 200 : 200);

  } catch (err) {
    Logger.log('REST dispatch error: ' + (err && err.stack ? err.stack : err));
    return _restJson_(errResult('เซิร์ฟเวอร์ผิดพลาด: ' + (err && err.message ? err.message : err)), 200);
  }
}

/**
 * _restParseBody_(e, method) — รวม body (POST JSON) + query params (GET) เป็น object เดียว
 * คืน { action, token, apiKey, payload, ...flatParams }
 * @private
 */
function _restParseBody_(e, method) {
  let body = {};

  // POST: อ่าน JSON จาก postData.contents
  if (e && e.postData && e.postData.contents) {
    try {
      body = JSON.parse(e.postData.contents) || {};
    } catch (parseErr) {
      throw new Error('Body ไม่ใช่ JSON ที่ถูกต้อง');
    }
  }

  // GET หรือ form params: รวม e.parameter เข้าไป (query string ทับได้)
  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(k => {
      if (body[k] === undefined) body[k] = e.parameter[k];
    });
  }

  if (!body.payload || typeof body.payload !== 'object') body.payload = {};
  return body;
}

/**
 * _restCheckApiKey_(body, route) — ตรวจ API key เฉพาะ public endpoint
 * คืน errResult ถ้าไม่ผ่าน, null ถ้าผ่าน
 * @private
 */
function _restCheckApiKey_(body, route) {
  if (!route.public) return null;          // endpoint ที่ใช้ token อยู่แล้ว ไม่ต้อง key
  const required = _getSetting_(REST_API_KEY_SETTING);
  if (!required) return null;              // ระบบไม่ได้ตั้ง key = ไม่บังคับ
  if (String(body.apiKey || '') !== String(required)) {
    return errResult('API key ไม่ถูกต้องหรือไม่ได้แนบมา');
  }
  return null;
}

/**
 * _getSetting_(key) — อ่านค่า Setting เดี่ยว (คืน string|null)
 * @private
 */
function _getSetting_(key) {
  try {
    const r = findData(SHEET_NAMES.SETTING, 'SettingKey', key);
    return (r && r.success && r.data) ? r.data.SettingValue : null;
  } catch (err) {
    return null;
  }
}

/**
 * _restJson_(obj) — ห่อ object เป็น JSON TextOutput
 * (หมายเหตุ: GAS ไม่รองรับการตั้ง HTTP status code จริง — ค่า 2nd arg
 *  มีไว้สื่อความหมายในโค้ดเท่านั้น, client ให้เช็คจาก field "success")
 * @private
 */
function _restJson_(obj, _statusHint) {
  return ContentService
    .createTextOutput(JSON.stringify(obj == null ? errResult('ไม่มีข้อมูลตอบกลับ') : obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// ── ROUTE TABLE ─────────────────────────────────────────────
//   action → { handler(body, e), public }
//   public: true  = endpoint สาธารณะ (จะถูกบังคับ API key ถ้าระบบตั้งไว้)
//   public: false = ต้องมี token (handler เช็คเอง)
// ============================================================
const REST_ROUTES = {
  // ── System / public ──
  'ping':           { public: true,  handler: function(b)    { return api_ping(); } },
  'getAppConfig':   { public: true,  handler: function(b)    { return api_getAppConfig(); } },
  'validateCID':    { public: true,  handler: function(b)    { return api_validateCID(b.payload.cid || b.cid); } },
  'formatDate':     { public: true,  handler: function(b)    { return api_formatDate(b.payload.dateStr || b.dateStr, b.payload.format || b.format); } },
  'parseDate':      { public: true,  handler: function(b)    { return api_parseDate(b.payload.dateText || b.dateText); } },

  // ── Auth ──
  'login':          { public: true,  handler: function(b)    { return api_login(b.payload.username || b.username, b.payload.password || b.password); } },
  'logout':         { public: false, handler: function(b)    { return api_logout(b.token); } },
  'getCurrentUser': { public: false, handler: function(b)    { return api_getCurrentUser(b.token); } },
  'changePassword': { public: false, handler: function(b)    { return api_changePassword(b.token, b.payload.oldPassword, b.payload.newPassword); } },

  // ── Permission ──
  'checkPermission':   { public: false, handler: function(b) { return api_checkPermission(b.token, b.payload.module || b.module, b.payload.action || b.actionName); } },
  'getPermissionMatrix': { public: false, handler: function(b) { return api_getPermissionMatrix(b.token); } },

  // ── Audit (admin) ──
  'getAuditLog':    { public: false, handler: function(b)    { return api_getAuditLog(b.token, b.payload.limit || b.limit); } },

  // ── Setup (ระวัง: เปิด public ไว้เพื่อ bootstrap ครั้งแรก) ──
  'setupSheets':    { public: true,  handler: function(b)    { return api_setupSheets(); } },

  // ── Client error logging ──
  'logClientError': { public: true,  handler: function(b)    { return api_logClientError(b.payload || {}); } },

  // ── Generic proxy: เลียนแบบ google.script.run ──
  //   body = { action:'invoke', fn:'api_xxx', args:[...] }
  //   ใช้โดย frontend ที่ host บน GitHub Pages (rpc() แบบ fetch)
  //   public:false = ข้าม API-key gate (ตัว api_* บังคับ token เอง)
  'invoke':         { public: false, handler: function(b)    { return _restInvoke_(b); } },

  // ============================================================
  // ── PATIENT / CASE (CaseService) ────────────────────────────
  // ============================================================
  'getPatients':        { public: false, handler: function(b) { return api_getPatients(b.token, b.payload.filters || {}); } },
  'getPatientById':     { public: false, handler: function(b) { return api_getPatientById(b.token, _pid_(b)); } },
  'savePatient':        { public: false, handler: function(b) { return api_savePatient(b.token, _data_(b)); } },
  'updatePatient':      { public: false, handler: function(b) { return api_updatePatient(b.token, _pid_(b), _data_(b)); } },
  'deletePatient':      { public: false, handler: function(b) { return api_deletePatient(b.token, _pid_(b)); } },
  'searchPatients':     { public: false, handler: function(b) { return api_searchPatients(b.token, b.payload.keyword || b.keyword); } },
  'getPatientTimeline': { public: false, handler: function(b) { return api_getPatientTimeline(b.token, _pid_(b)); } },
  'getDashboardData':   { public: false, handler: function(b) { return api_getDashboardData(b.token, b.payload.filters || {}); } },

  // ============================================================
  // ── CARE PLAN (CarePlanService) ─────────────────────────────
  // ============================================================
  'saveCarePlan':         { public: false, handler: function(b) { return api_saveCarePlan(b.token, _data_(b)); } },
  'updateCarePlan':       { public: false, handler: function(b) { return api_updateCarePlan(b.token, b.payload.carePlanId || b.carePlanId, _data_(b)); } },
  'approveCarePlan':      { public: false, handler: function(b) { return api_approveCarePlan(b.token, b.payload.carePlanId || b.carePlanId); } },
  'getCarePlanByPatient': { public: false, handler: function(b) { return api_getCarePlanByPatient(b.token, _pid_(b)); } },
  'getActiveCarePlan':    { public: false, handler: function(b) { return api_getActiveCarePlan(b.token, _pid_(b)); } },

  // ============================================================
  // ── VISIT (VisitService) ────────────────────────────────────
  // ============================================================
  'saveVisit':           { public: false, handler: function(b) { return api_saveVisit(b.token, _data_(b)); } },
  'updateVisit':         { public: false, handler: function(b) { return api_updateVisit(b.token, b.payload.visitId || b.visitId, _data_(b)); } },
  'getVisitsByPatient':  { public: false, handler: function(b) { return api_getVisitsByPatient(b.token, _pid_(b)); } },
  'getVisitById':        { public: false, handler: function(b) { return api_getVisitById(b.token, b.payload.visitId || b.visitId); } },
  'calculateVisitNo':    { public: false, handler: function(b) { return api_calculateVisitNo(b.token, _pid_(b)); } },
  'getOverdueVisits':    { public: false, handler: function(b) { return api_getOverdueVisits(b.token); } },
  'getUpcomingVisits':   { public: false, handler: function(b) { return api_getUpcomingVisits(b.token, b.payload.days || b.days); } },

  // ============================================================
  // ── ASSESSMENT (AssessmentService) ──────────────────────────
  // ============================================================
  'saveVitalSigns':          { public: false, handler: function(b) { return api_saveVitalSigns(b.token, _data_(b)); } },
  'getVitalSignsByPatient':  { public: false, handler: function(b) { return api_getVitalSignsByPatient(b.token, _pid_(b)); } },
  'saveADL':                 { public: false, handler: function(b) { return api_saveADL(b.token, _data_(b)); } },
  'getADLByPatient':         { public: false, handler: function(b) { return api_getADLByPatient(b.token, _pid_(b)); } },
  'savePPS':                 { public: false, handler: function(b) { return api_savePPS(b.token, _data_(b)); } },
  'getPPSByPatient':         { public: false, handler: function(b) { return api_getPPSByPatient(b.token, _pid_(b)); } },
  'saveMentalHealth':        { public: false, handler: function(b) { return api_saveMentalHealth(b.token, _data_(b)); } },
  'getMentalHealthByPatient':{ public: false, handler: function(b) { return api_getMentalHealthByPatient(b.token, _pid_(b)); } },
  'getAssessmentMeta':       { public: false, handler: function(b) { return api_getAssessmentMeta(b.token); } },
  // ── เครื่องคิดเลข/แปลผล (ไม่ต้อง auth) ──
  'calculateBMI':         { public: true,  handler: function(b) { return api_calculateBMI(b.payload.weight, b.payload.height); } },
  'interpretBMI':         { public: true,  handler: function(b) { return api_interpretBMI(b.payload.bmi); } },
  'interpretBP':          { public: true,  handler: function(b) { return api_interpretBP(b.payload.sbp, b.payload.dbp); } },
  'interpretDTX':         { public: true,  handler: function(b) { return api_interpretDTX(b.payload.dtx); } },
  'interpretADL':         { public: true,  handler: function(b) { return api_interpretADL(b.payload.totalScore); } },
  'classifyTAI':          { public: true,  handler: function(b) { return api_classifyTAI(b.payload.totalScore, b.payload.hasCognitive); } },
  'interpretPPS':         { public: true,  handler: function(b) { return api_interpretPPS(b.payload.score); } },
  'calculate2Q':          { public: true,  handler: function(b) { return api_calculate2Q(_data_(b)); } },
  'calculate9Q':          { public: true,  handler: function(b) { return api_calculate9Q(_data_(b)); } },
  'interpretMentalHealth':{ public: true,  handler: function(b) { return api_interpretMentalHealth(b.payload.score, b.payload.type); } },
  'detectHighRisk':       { public: true,  handler: function(b) { return api_detectHighRisk(_data_(b)); } },

  // ============================================================
  // ── BENEFIT (BenefitService) ────────────────────────────────
  // ============================================================
  'getBenefitItems':            { public: false, handler: function(b) { return api_getBenefitItems(b.token); } },
  'saveBenefitReport':          { public: false, handler: function(b) { return api_saveBenefitReport(b.token, _data_(b)); } },
  'getBenefitReportsByPatient': { public: false, handler: function(b) { return api_getBenefitReportsByPatient(b.token, _pid_(b), b.payload.fiscalYear || b.fiscalYear); } },

  // ============================================================
  // ── REPORT (ReportService) ──────────────────────────────────
  // ============================================================
  'getAnalytics':       { public: false, handler: function(b) { return api_getAnalytics(b.token, b.payload.filters || {}); } },
  'getIndividualReport':{ public: false, handler: function(b) { return api_getIndividualReport(b.token, _pid_(b)); } },
  'getMonthlyReport':   { public: false, handler: function(b) { return api_getMonthlyReport(b.token, b.payload.filters || {}); } },
  'exportReport':       { public: false, handler: function(b) { return api_exportReport(b.token, b.payload.reportType || b.reportType, b.payload.filters || {}); } },

  // ============================================================
  // ── PHOTO / UPLOAD (UploadService) ──────────────────────────
  // ============================================================
  'uploadPhoto':       { public: false, handler: function(b) { return api_uploadPhoto(b.token, b.payload.base64, b.payload.filename, b.payload.patientId, b.payload.visitId, b.payload.caption, b.payload.consent); } },
  'getPhotosByVisit':  { public: false, handler: function(b) { return api_getPhotosByVisit(b.token, b.payload.visitId || b.visitId); } },
  'getPhotosByPatient':{ public: false, handler: function(b) { return api_getPhotosByPatient(b.token, _pid_(b)); } },
  'deletePhoto':       { public: false, handler: function(b) { return api_deletePhoto(b.token, b.payload.photoId || b.photoId); } },

  // ============================================================
  // ── MAP (MapService) ────────────────────────────────────────
  // ============================================================
  'getMapCases':       { public: false, handler: function(b) { return api_getMapCases(b.token, b.payload.filters || {}); } },

  // ============================================================
  // ── MESSAGING / NOTIFICATION (MessagingService) ─────────────
  // ============================================================
  'getSettings':              { public: false, handler: function(b) { return api_getSettings(b.token); } },
  'saveSettings':             { public: false, handler: function(b) { return api_saveSettings(b.token, _data_(b)); } },
  'sendLineAlert':            { public: false, handler: function(b) { return api_sendLineAlert(b.token, b.payload.message, b.payload.target); } },
  'notifyUpcomingVisits':     { public: false, handler: function(b) { return api_notifyUpcomingVisits(b.token, b.payload.days || b.days); } },
  'notifyOverdueVisits':      { public: false, handler: function(b) { return api_notifyOverdueVisits(b.token); } },
  'notifyHighRiskMentalHealth':{ public: false, handler: function(b) { return api_notifyHighRiskMentalHealth(b.token); } },
  'notifyAbnormalVitalSigns': { public: false, handler: function(b) { return api_notifyAbnormalVitalSigns(b.token); } },
  'notifyPPSDecline':         { public: false, handler: function(b) { return api_notifyPPSDecline(b.token); } },
  'getNotifications':         { public: false, handler: function(b) { return api_getNotifications(b.token, b.payload.limit || b.limit); } },
  'resendNotification':       { public: false, handler: function(b) { return api_resendNotification(b.token, b.payload.notificationId || b.notificationId); } }
};

/**
 * _pid_(b) — ดึง patientId จาก payload หรือ flat param
 * @private
 */
function _pid_(b) {
  return b.payload.patientId || b.patientId;
}

/**
 * _data_(b) — ดึง record object: payload.data ถ้ามี, ไม่งั้นใช้ทั้ง payload
 * @private
 */
function _data_(b) {
  return (b.payload && b.payload.data && typeof b.payload.data === 'object')
    ? b.payload.data
    : (b.payload || {});
}

// ============================================================
// ── GENERIC INVOKE (google.script.run-compatible proxy) ─────
// ============================================================

/**
 * INVOKE_ALLOW — รายชื่อ api_* ที่อนุญาตให้เรียกผ่าน action:'invoke'
 * (allowlist กันคนนอกเรียกฟังก์ชันภายใน เช่น helper หรือ setup ที่อันตราย)
 * ฟังก์ชันที่ต้อง auth จะถูกบังคับ token โดยตัวมันเองอยู่แล้ว
 */
const INVOKE_ALLOW = new Set([
  // System / public
  'api_ping', 'api_getAppConfig', 'api_validateCID', 'api_formatDate', 'api_parseDate',
  'api_logClientError',
  // Auth
  'api_login', 'api_logout', 'api_getCurrentUser', 'api_changePassword',
  // Permission
  'api_checkPermission', 'api_getPermissionMatrix', 'api_getAuditLog',
  // User management (admin)
  'api_getUsers', 'api_createUser', 'api_updateUser', 'api_setUserActive',
  // Patient / Case
  'api_getPatients', 'api_getPatientById', 'api_savePatient', 'api_updatePatient',
  'api_deletePatient', 'api_searchPatients', 'api_getPatientTimeline', 'api_getDashboardData',
  'api_getCaregivers',
  // Care Plan
  'api_saveCarePlan', 'api_updateCarePlan', 'api_approveCarePlan',
  'api_getCarePlanByPatient', 'api_getActiveCarePlan',
  // Visit
  'api_saveVisit', 'api_updateVisit', 'api_getVisitsByPatient', 'api_getVisitById',
  'api_calculateVisitNo', 'api_getOverdueVisits', 'api_getUpcomingVisits',
  // Assessment
  'api_saveVitalSigns', 'api_getVitalSignsByPatient', 'api_saveADL', 'api_getADLByPatient',
  'api_savePPS', 'api_getPPSByPatient', 'api_saveMentalHealth', 'api_getMentalHealthByPatient',
  'api_getAssessmentMeta', 'api_calculateBMI', 'api_interpretBMI', 'api_interpretBP',
  'api_interpretDTX', 'api_interpretADL', 'api_classifyTAI', 'api_interpretPPS',
  'api_calculate2Q', 'api_calculate9Q', 'api_interpretMentalHealth', 'api_detectHighRisk',
  // Benefit
  'api_getBenefitItems', 'api_saveBenefitReport', 'api_getBenefitReportsByPatient',
  // Report
  'api_getAnalytics', 'api_getIndividualReport', 'api_getMonthlyReport', 'api_exportReport',
  // Photo
  'api_uploadPhoto', 'api_getPhotosByVisit', 'api_getPhotosByPatient', 'api_deletePhoto',
  // Map
  'api_getMapCases',
  // Messaging / Notification
  'api_getSettings', 'api_saveSettings', 'api_sendLineAlert', 'api_notifyUpcomingVisits',
  'api_notifyOverdueVisits', 'api_notifyHighRiskMentalHealth', 'api_notifyAbnormalVitalSigns',
  'api_notifyPPSDecline', 'api_getNotifications', 'api_resendNotification'
]);

/**
 * _restInvoke_(b) — เรียก api_* ตามชื่อ พร้อม positional args (เลียนแบบ google.script.run)
 * @param {Object} b - { fn:'api_xxx', args:[...] }
 * @private
 */
function _restInvoke_(b) {
  const fn = b.fn || b.name;
  if (!fn) return errResult('ไม่ได้ระบุชื่อฟังก์ชัน (fn)');
  if (!INVOKE_ALLOW.has(fn)) return errResult('ไม่อนุญาตให้เรียกฟังก์ชัน: ' + fn);

  const f = globalThis[fn];
  if (typeof f !== 'function') return errResult('ไม่พบฟังก์ชัน: ' + fn);

  const args = Array.isArray(b.args) ? b.args : [];
  return f.apply(null, args);
}
