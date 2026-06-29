/**
 * ============================================================
 * VisitService.gs - Home Visit Management
 * ============================================================
 * จัดการการเยี่ยมบ้าน (Home Visit)
 * - ทุก Visit ต้องมี PatientID
 * - VisitNo คำนวณอัตโนมัติด้วย LockService (กัน race condition)
 * - admin/cm/cg ที่รับผิดชอบ patient เท่านั้นที่บันทึก visit ได้
 * - viewer ดูได้อย่างเดียว
 * - บันทึก Audit Log ทุกครั้ง
 * ============================================================
 */

// ── VisitType ที่อนุญาต ──
const VISIT_TYPES = ['home_visit','clinic','phone','emergency','follow_up'];

/**
 * _checkPatientForVisit_(patientId, user) — ตรวจสิทธิ์ + คืน patient record
 * @private
 */
function _checkPatientForVisit_(patientId, user) {
  if (!patientId) throw new Error('ต้องระบุ PatientID ไม่อนุญาตให้บันทึก Visit ที่ไม่มีผู้ป่วย');
  const result = findData(SHEET_NAMES.PATIENTS, 'PatientID', patientId);
  if (!result.success || !result.data) throw new Error('ไม่พบผู้ป่วย: ' + patientId);
  const p = result.data;
  if (user.role === 'admin' || user.role === 'viewer') return p;
  if (user.role === 'cm' && p.CareManagerID === user.userId) return p;
  if (user.role === 'cg' && p.CaregiverID === user.userId) return p;
  throw new Error('ไม่มีสิทธิ์บันทึก Visit ของผู้ป่วยรายนี้');
}

/**
 * _sanitizeVisit_(v) — เตรียมข้อมูลก่อนส่ง client
 * @private
 */
function _sanitizeVisit_(v) {
  if (!v) return null;
  const out = {};
  Object.entries(v).forEach(([k, val]) => {
    if (k === '__rowIndex') return;
    if (val instanceof Date) { out[k] = val.toISOString(); return; }
    out[k] = val;
  });
  return out;
}

// ============================================================
// ── VISIT NO AUTO-CALCULATION ───────────────────────────────
// ============================================================

/**
 * calculateVisitNo(patientId) — คำนวณ VisitNo ถัดไปสำหรับผู้ป่วย
 * นับจาก visit ที่มีอยู่ + 1
 * ใช้ LockService ป้องกัน race condition
 * @param {string} patientId
 * @returns {Object} {success, data: {visitNo}, message}
 */
function calculateVisitNo(patientId) {
  try {
    if (!patientId) return errResult('ต้องระบุ PatientID');
    const result = findAllData(SHEET_NAMES.VISITS, r => r.PatientID === patientId);
    if (!result.success) return result;
    const visitNo = (result.data || []).length + 1;
    return okResult({ visitNo }, 'VisitNo ถัดไปคือ ' + visitNo);
  } catch (err) {
    Logger.log('calculateVisitNo error: ' + err);
    return errResult('คำนวณ VisitNo ไม่สำเร็จ: ' + err.message);
  }
}

// ============================================================
// ── VISIT CRUD ──────────────────────────────────────────────
// ============================================================

/**
 * saveVisit(data) — บันทึกการเยี่ยมใหม่ (admin/cm/cg)
 * - ห้ามบันทึกถ้าไม่มี PatientID
 * - VisitNo คำนวณอัตโนมัติด้วย LockService
 * @param {Object} data - field ตาม schema Visit
 * @returns {Object} {success, data: {visitId, visitNo}, message}
 */
function saveVisit(data) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'visit', 'create');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์บันทึก Visit');

    if (!data || typeof data !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');

    // ── ต้องมี PatientID ──
    if (!data.PatientID) {
      return errResult('ต้องระบุ PatientID ไม่อนุญาตให้บันทึก Visit ที่ไม่มีผู้ป่วย');
    }

    // ── ตรวจสิทธิ์ + ดึง patient ──
    const patient = _checkPatientForVisit_(data.PatientID, user);

    // ── Validate visit date ──
    if (!data.VisitDate) return errResult('กรุณาระบุวันที่เยี่ยม (VisitDate)');

    // ── Validate VisitType ──
    const visitType = data.VisitType || 'home_visit';
    if (!VISIT_TYPES.includes(visitType)) {
      return errResult('VisitType ไม่ถูกต้อง (ต้องเป็น: ' + VISIT_TYPES.join(',') + ')');
    }

    // ── คำนวณ VisitNo ภายใต้ LockService (กัน race condition) ──
    const lock = LockService.getScriptLock();
    let visitNo;
    try {
      lock.waitLock(15000);
      const noResult = calculateVisitNo(data.PatientID);
      if (!noResult.success) return noResult;
      visitNo = noResult.data.visitNo;

      const visitId = generateId('VT');
      const now = new Date().toISOString();

      const record = {
        VisitID:               visitId,
        PatientID:             data.PatientID,
        VisitNo:               visitNo,
        VisitDate:             data.VisitDate,
        StartTime:             data.StartTime || '',
        EndTime:               data.EndTime || '',
        VisitorID:             data.VisitorID || user.userId,
        VisitorName:           data.VisitorName || user.fullName || user.username,
        VisitType:             visitType,
        MainProblem:           data.MainProblem || '',
        CareProvided:          data.CareProvided || '',
        HealthEducation:       data.HealthEducation || '',
        FamilyParticipation:   data.FamilyParticipation || '',
        EnvironmentIssue:      data.EnvironmentIssue || '',
        MedicationIssue:       data.MedicationIssue || '',
        NutritionIssue:        data.NutritionIssue || '',
        RehabilitationIssue:   data.RehabilitationIssue || '',
        PsychosocialIssue:     data.PsychosocialIssue || '',
        ReferralAction:        data.ReferralAction || '',
        NextVisitDate:         data.NextVisitDate || '',
        VisitSummary:          data.VisitSummary || '',
        PhotoURLs:             _toJsonString_(data.PhotoURLs),
        Latitude:              data.Latitude || '',
        Longitude:             data.Longitude || '',
        CreatedAt:             now,
        UpdatedAt:             '',
        CreatedBy:             user.userId
      };

      const r = appendData(SHEET_NAMES.VISITS, record);
      if (!r.success) return r;

      writeAuditLog('CREATE', 'visit', visitId, null, {
        patientId: data.PatientID,
        patientName: patient.FullName,
        visitNo,
        visitDate: data.VisitDate,
        visitType
      });

      return okResult({ visitId, visitNo }, 'บันทึก Visit ครั้งที่ ' + visitNo + ' สำเร็จ');
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
  } catch (err) {
    Logger.log('saveVisit error: ' + err.stack);
    writeAuditLogFailed_('CREATE', 'visit', '', err.message);
    return errResult('บันทึก Visit ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * updateVisit(visitId, data) — แก้ไข Visit (admin/cm/cg)
 * cg แก้ได้เฉพาะ visit ที่ตัวเองเป็น visitor + ภายในวันที่บันทึก
 * @param {string} visitId
 * @param {Object} data
 */
function updateVisit(visitId, data) {
  try {
    if (!visitId) return errResult('กรุณาระบุ VisitID');
    if (!data || typeof data !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');

    const user = requireAuth_();
    const check = checkPermission(user.role, 'visit', 'update');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์แก้ไข Visit');

    const existing = findData(SHEET_NAMES.VISITS, 'VisitID', visitId);
    if (!existing.success || !existing.data) return errResult('ไม่พบ Visit: ' + visitId);

    // ── ตรวจสิทธิ์เข้าถึง patient ──
    _checkPatientForVisit_(existing.data.PatientID, user);

    // ── cg แก้ได้เฉพาะของตัวเอง + วันเดียวกัน ──
    if (user.role === 'cg') {
      if (existing.data.VisitorID !== user.userId) {
        return errResult('CG แก้ไขได้เฉพาะ Visit ที่ตัวเองเป็นผู้เยี่ยม');
      }
      const visitDate = String(existing.data.VisitDate||'').split('T')[0];
      const today = formatDateISO(new Date());
      if (visitDate !== today) {
        return errResult('CG แก้ไข Visit ได้ภายในวันที่บันทึกเท่านั้น');
      }
    }

    // ── ห้ามแก้ฟิลด์สงวน ──
    const protectedFields = ['VisitID','PatientID','VisitNo','CreatedBy','CreatedAt'];
    protectedFields.forEach(f => delete data[f]);

    // ── แปลง array → JSON ──
    if (Array.isArray(data.PhotoURLs)) data.PhotoURLs = _toJsonString_(data.PhotoURLs);

    // ── Validate VisitType ──
    if (data.VisitType && !VISIT_TYPES.includes(data.VisitType)) {
      return errResult('VisitType ไม่ถูกต้อง');
    }

    const r = updateData(SHEET_NAMES.VISITS, 'VisitID', visitId, data);
    if (!r.success) return r;

    writeAuditLog('UPDATE', 'visit', visitId,
      { visitNo: existing.data.VisitNo, patientId: existing.data.PatientID },
      { fields: r.data.updatedFields }
    );

    return okResult(null, 'อัปเดต Visit สำเร็จ');
  } catch (err) {
    Logger.log('updateVisit error: ' + err.stack);
    writeAuditLogFailed_('UPDATE', 'visit', visitId, err.message);
    return errResult('อัปเดตไม่สำเร็จ: ' + err.message);
  }
}

/**
 * getVisitsByPatient(patientId) — ดึง Visit ทั้งหมดของผู้ป่วย
 * เรียง VisitNo มาก→น้อย (ใหม่สุดก่อน)
 */
function getVisitsByPatient(patientId) {
  try {
    if (!patientId) return errResult('กรุณาระบุ PatientID');
    const user = requireAuth_();
    const check = checkPermission(user.role, 'visit', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดู Visit');

    _checkPatientForVisit_(patientId, user);

    const result = findAllData(SHEET_NAMES.VISITS, r => r.PatientID === patientId);
    if (!result.success) return result;

    const sorted = (result.data || [])
      .sort((a, b) => (parseInt(b.VisitNo)||0) - (parseInt(a.VisitNo)||0))
      .map(_sanitizeVisit_);

    return okResult(sorted, 'พบ ' + sorted.length + ' Visit');
  } catch (err) {
    Logger.log('getVisitsByPatient error: ' + err.stack);
    return errResult('ดึง Visit ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * getVisitById(visitId) — ดึงข้อมูล Visit รายเดียว
 */
function getVisitById(visitId) {
  try {
    if (!visitId) return errResult('กรุณาระบุ VisitID');
    const user = requireAuth_();
    const check = checkPermission(user.role, 'visit', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดู Visit');

    const result = findData(SHEET_NAMES.VISITS, 'VisitID', visitId);
    if (!result.success || !result.data) return errResult('ไม่พบ Visit: ' + visitId);

    _checkPatientForVisit_(result.data.PatientID, user);

    return okResult(_sanitizeVisit_(result.data), 'พบข้อมูล');
  } catch (err) {
    Logger.log('getVisitById error: ' + err.stack);
    return errResult('ดึงข้อมูลไม่สำเร็จ: ' + err.message);
  }
}

/**
 * getOverdueVisits() — ดึงผู้ป่วยที่นัด NextVisitDate ผ่านไปแล้วยังไม่ได้เยี่ยม
 * พิจารณาจาก visit ล่าสุดของแต่ละ patient
 * @returns {Object} {success, data: [...], message}
 */
function getOverdueVisits() {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'visit', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดู Visit');

    // ── ดึง patient ที่อยู่ในสิทธิ์ ──
    const patientResult = findAllData(SHEET_NAMES.PATIENTS, r => {
      const s = String(r.Status||'').toLowerCase();
      return s !== 'deleted' && s !== 'inactive';
    });
    if (!patientResult.success) return patientResult;
    const myPatients = _filterByRole_(patientResult.data, user);
    const myPatientIds = new Set(myPatients.map(p => p.PatientID));

    // ── ดึง visit ของผู้ป่วยในสิทธิ์ ──
    const visitResult = findAllData(SHEET_NAMES.VISITS, r => myPatientIds.has(r.PatientID));
    if (!visitResult.success) return visitResult;

    // ── หา visit ล่าสุดของแต่ละ patient ──
    const latestByPatient = {};
    (visitResult.data || []).forEach(v => {
      const cur = latestByPatient[v.PatientID];
      if (!cur || (parseInt(v.VisitNo)||0) > (parseInt(cur.VisitNo)||0)) {
        latestByPatient[v.PatientID] = v;
      }
    });

    // ── หา overdue (NextVisitDate < today) ──
    const today = formatDateISO(new Date());
    const overdue = [];
    myPatients.forEach(p => {
      const lastVisit = latestByPatient[p.PatientID];
      if (!lastVisit) {
        // ไม่เคยเยี่ยมเลย ถ้า register นานเกิน 30 วัน นับ overdue
        if (p.RegisterDate) {
          const daysSince = _daysBetween_(p.RegisterDate, today);
          if (daysSince > 30) {
            overdue.push({
              patientId: p.PatientID,
              fullName: p.FullName,
              phone: p.Phone,
              caregiverId: p.CaregiverID,
              lastVisitDate: null,
              nextVisitDate: null,
              daysSinceRegister: daysSince,
              reason: 'ยังไม่เคยเยี่ยม (ลงทะเบียน ' + daysSince + ' วันที่แล้ว)'
            });
          }
        }
        return;
      }
      const nextDate = String(lastVisit.NextVisitDate||'').split('T')[0];
      if (nextDate && nextDate < today) {
        const overdueDays = _daysBetween_(nextDate, today);
        overdue.push({
          patientId: p.PatientID,
          fullName: p.FullName,
          phone: p.Phone,
          caregiverId: p.CaregiverID,
          lastVisitDate: String(lastVisit.VisitDate||'').split('T')[0],
          nextVisitDate: nextDate,
          overdueDays,
          reason: 'เลยกำหนดเยี่ยม ' + overdueDays + ' วัน'
        });
      }
    });

    // ── เรียง overdueDays มาก→น้อย ──
    overdue.sort((a, b) => (b.overdueDays||b.daysSinceRegister||0) - (a.overdueDays||a.daysSinceRegister||0));

    return okResult(overdue, 'พบ ' + overdue.length + ' ราย overdue');
  } catch (err) {
    Logger.log('getOverdueVisits error: ' + err.stack);
    return errResult('ดึง overdue ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * getUpcomingVisits(days) — ดึงนัดเยี่ยมในอีก N วันข้างหน้า
 * @param {number} [days] - default 7
 * @returns {Object}
 */
function getUpcomingVisits(days) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'visit', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดู Visit');

    const daysAhead = parseInt(days) || 7;

    // ── ดึง patient ที่อยู่ในสิทธิ์ ──
    const patientResult = findAllData(SHEET_NAMES.PATIENTS, r => {
      const s = String(r.Status||'').toLowerCase();
      return s !== 'deleted' && s !== 'inactive';
    });
    if (!patientResult.success) return patientResult;
    const myPatients = _filterByRole_(patientResult.data, user);
    const myPatientMap = {};
    myPatients.forEach(p => { myPatientMap[p.PatientID] = p; });

    // ── ดึง visit ──
    const visitResult = findAllData(SHEET_NAMES.VISITS, r => myPatientMap[r.PatientID]);
    if (!visitResult.success) return visitResult;

    // ── visit ล่าสุดต่อ patient ──
    const latestByPatient = {};
    (visitResult.data || []).forEach(v => {
      const cur = latestByPatient[v.PatientID];
      if (!cur || (parseInt(v.VisitNo)||0) > (parseInt(cur.VisitNo)||0)) {
        latestByPatient[v.PatientID] = v;
      }
    });

    const today = formatDateISO(new Date());
    const cutoff = formatDateISO(new Date(Date.now() + daysAhead * 86400 * 1000));

    const upcoming = [];
    Object.values(latestByPatient).forEach(v => {
      const nextDate = String(v.NextVisitDate||'').split('T')[0];
      if (nextDate && nextDate >= today && nextDate <= cutoff) {
        const p = myPatientMap[v.PatientID];
        upcoming.push({
          patientId: v.PatientID,
          fullName: p.FullName,
          phone: p.Phone,
          caregiverId: p.CaregiverID,
          lastVisitNo: v.VisitNo,
          nextVisitDate: nextDate,
          daysUntil: _daysBetween_(today, nextDate)
        });
      }
    });

    upcoming.sort((a, b) => String(a.nextVisitDate).localeCompare(String(b.nextVisitDate)));

    return okResult(upcoming, 'พบ ' + upcoming.length + ' นัดในอีก ' + daysAhead + ' วัน');
  } catch (err) {
    Logger.log('getUpcomingVisits error: ' + err.stack);
    return errResult('ดึง upcoming ไม่สำเร็จ: ' + err.message);
  }
}

// ============================================================
// ── HELPERS ─────────────────────────────────────────────────
// ============================================================

/**
 * _daysBetween_(d1, d2) — จำนวนวันห่างระหว่าง 2 วัน (d2 - d1)
 * @private
 */
function _daysBetween_(d1, d2) {
  try {
    const a = new Date(String(d1).split('T')[0]);
    const b = new Date(String(d2).split('T')[0]);
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.floor((b - a) / 86400000);
  } catch (e) { return 0; }
}

// ============================================================
// ── API WRAPPERS ────────────────────────────────────────────
// ============================================================

function api_saveVisit(token, data) {
  _CURRENT_TOKEN_ = token;
  try { return saveVisit(data); } catch (err) { return errResult(err.message); }
}

function api_updateVisit(token, visitId, data) {
  _CURRENT_TOKEN_ = token;
  try { return updateVisit(visitId, data); } catch (err) { return errResult(err.message); }
}

function api_getVisitsByPatient(token, patientId) {
  _CURRENT_TOKEN_ = token;
  try { return getVisitsByPatient(patientId); } catch (err) { return errResult(err.message); }
}

function api_getVisitById(token, visitId) {
  _CURRENT_TOKEN_ = token;
  try { return getVisitById(visitId); } catch (err) { return errResult(err.message); }
}

function api_calculateVisitNo(token, patientId) {
  _CURRENT_TOKEN_ = token;
  try {
    requireAuth_();
    return calculateVisitNo(patientId);
  } catch (err) { return errResult(err.message); }
}

function api_getOverdueVisits(token) {
  _CURRENT_TOKEN_ = token;
  try { return getOverdueVisits(); } catch (err) { return errResult(err.message); }
}

function api_getUpcomingVisits(token, days) {
  _CURRENT_TOKEN_ = token;
  try { return getUpcomingVisits(days); } catch (err) { return errResult(err.message); }
}

/**
 * api_getVisitOptions(token) — ตัวเลือกหน้าเยี่ยมบ้านจากชีต Symptom
 * A2:A = อาการ/ปัญหา · B2:B = การดูแล · C2:C = สุขศึกษา
 * @returns {Object} { success, data: { symptoms:[], care:[], education:[] } }
 */
function api_getVisitOptions(token) {
  _CURRENT_TOKEN_ = token;
  try {
    requireAuth_();
    const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.SYMPTOM);
    if (!sh) return okResult({ symptoms: [], care: [], education: [] }, 'ยังไม่มีชีต Symptom');
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return okResult({ symptoms: [], care: [], education: [] }, 'ยังไม่มีข้อมูลตัวเลือก');
    const values = sh.getRange(2, 1, lastRow - 1, 3).getValues();
    const col = (i) => {
      const seen = {};
      return values.map(r => String(r[i] == null ? '' : r[i]).trim())
                   .filter(v => v && !seen[v] && (seen[v] = true));
    };
    return okResult({ symptoms: col(0), care: col(1), education: col(2) }, 'ตัวเลือกหน้าเยี่ยม');
  } catch (err) {
    Logger.log('api_getVisitOptions error: ' + err.stack);
    return errResult(err.message);
  }
}
