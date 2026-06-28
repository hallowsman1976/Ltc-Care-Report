/**
 * ============================================================
 * CarePlanService.gs - Care Plan Management
 * ============================================================
 * จัดการแผนการดูแลรายบุคคล (Care Plan)
 * - 1 ผู้ป่วยมีได้หลาย CarePlan แต่ active ได้ครั้งละ 1 plan
 * - ต้องมี PatientID เสมอ
 * - admin/cm สร้างและอนุมัติได้
 * - cg/viewer ดูได้อย่างเดียว
 * - บันทึก Audit Log ทุกครั้ง
 * ============================================================
 */

// ── PlanStatus ที่อนุญาต ──
const CARE_PLAN_STATUSES = ['draft','active','completed','cancelled'];

/**
 * _checkPatientAccess_(patientId, user) — ตรวจสอบสิทธิ์เข้าถึง patient + คืน patient record
 * @private
 */
function _checkPatientAccess_(patientId, user) {
  const result = findData(SHEET_NAMES.PATIENTS, 'PatientID', patientId);
  if (!result.success || !result.data) {
    throw new Error('ไม่พบผู้ป่วย: ' + patientId);
  }
  const p = result.data;
  if (user.role === 'admin' || user.role === 'viewer') return p;
  if (user.role === 'cm' && p.CareManagerID === user.userId) return p;
  if (user.role === 'cg' && p.CaregiverID === user.userId) return p;
  throw new Error('ไม่มีสิทธิ์เข้าถึงข้อมูลผู้ป่วยรายนี้');
}

/**
 * _sanitizeCarePlan_(cp) — เตรียมข้อมูลก่อนส่ง client
 * @private
 */
function _sanitizeCarePlan_(cp) {
  if (!cp) return null;
  const out = {};
  Object.entries(cp).forEach(([k, v]) => {
    if (k === '__rowIndex') return;
    if (v instanceof Date) { out[k] = v.toISOString(); return; }
    out[k] = v;
  });
  return out;
}

// ============================================================
// ── CARE PLAN CRUD ──────────────────────────────────────────
// ============================================================

/**
 * saveCarePlan(data) — สร้าง Care Plan ใหม่
 * admin/cm สร้างได้
 * @param {Object} data - { PatientID, PlanDate, ProblemList, GoalOfCare, ServicePackage,
 *                          FrequencyPerMonth, EquipmentNeed, ReferralNeed, BudgetAmount,
 *                          StartDate, EndDate, PlanStatus }
 * @returns {Object} {success, data: {carePlanId}, message}
 */
function saveCarePlan(data) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'careplan', 'create');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์สร้าง Care Plan');

    if (!data || typeof data !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');
    if (!data.PatientID) return errResult('ต้องระบุ PatientID');
    if (!data.PlanDate)  return errResult('กรุณาระบุวันที่ทำ Care Plan');

    // ── ตรวจสอบ patient + สิทธิ์ ──
    _checkPatientAccess_(data.PatientID, user);

    // ── ตรวจสอบ PlanStatus ──
    const status = data.PlanStatus || 'draft';
    if (!CARE_PLAN_STATUSES.includes(status)) {
      return errResult('สถานะไม่ถูกต้อง (ต้องเป็น: ' + CARE_PLAN_STATUSES.join(',') + ')');
    }

    const carePlanId = generateId('CP');
    const now = new Date().toISOString();

    const record = {
      CarePlanID:        carePlanId,
      PatientID:         data.PatientID,
      PlanDate:          data.PlanDate || formatDateISO(new Date()),
      ProblemList:       _toJsonString_(data.ProblemList),
      GoalOfCare:        data.GoalOfCare || '',
      ServicePackage:    _toJsonString_(data.ServicePackage),
      FrequencyPerMonth: data.FrequencyPerMonth || '',
      EquipmentNeed:     _toJsonString_(data.EquipmentNeed),
      ReferralNeed:      data.ReferralNeed || '',
      BudgetAmount:      data.BudgetAmount || 0,
      StartDate:         data.StartDate || '',
      EndDate:           data.EndDate || '',
      ApprovedBy:        '',
      ApprovedDate:      '',
      PlanStatus:        status,
      CreatedBy:         user.userId,
      CreatedAt:         now,
      UpdatedAt:         ''
    };

    const r = appendData(SHEET_NAMES.CARE_PLANS, record);
    if (!r.success) return r;

    writeAuditLog('CREATE', 'careplan', carePlanId, null, {
      patientId: data.PatientID,
      status,
      goal: data.GoalOfCare
    });

    return okResult({ carePlanId }, 'สร้าง Care Plan สำเร็จ');
  } catch (err) {
    Logger.log('saveCarePlan error: ' + err.stack);
    writeAuditLogFailed_('CREATE', 'careplan', '', err.message);
    return errResult('สร้าง Care Plan ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * updateCarePlan(carePlanId, data) — อัปเดต Care Plan
 * @param {string} carePlanId
 * @param {Object} data
 * @returns {Object}
 */
function updateCarePlan(carePlanId, data) {
  try {
    if (!carePlanId) return errResult('กรุณาระบุ CarePlanID');
    if (!data || typeof data !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');

    const user = requireAuth_();
    const check = checkPermission(user.role, 'careplan', 'update');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์แก้ไข Care Plan');

    const existing = findData(SHEET_NAMES.CARE_PLANS, 'CarePlanID', carePlanId);
    if (!existing.success || !existing.data) return errResult('ไม่พบ Care Plan: ' + carePlanId);

    // ── ตรวจสิทธิ์เข้าถึง patient ──
    _checkPatientAccess_(existing.data.PatientID, user);

    // ── อนุมัติแล้วห้ามแก้ ──
    if (existing.data.PlanStatus === 'completed' || existing.data.PlanStatus === 'cancelled') {
      // ยอมให้แก้ status กลับมาเท่านั้น
      if (!('PlanStatus' in data)) {
        return errResult('Care Plan ปิดแล้ว ไม่สามารถแก้ไขได้');
      }
    }

    // ── ห้ามแก้ฟิลด์สงวน ──
    const protectedFields = ['CarePlanID','PatientID','CreatedBy','CreatedAt','ApprovedBy','ApprovedDate'];
    protectedFields.forEach(f => delete data[f]);

    // ── แปลง array → JSON string ──
    if (Array.isArray(data.ProblemList))    data.ProblemList    = _toJsonString_(data.ProblemList);
    if (Array.isArray(data.ServicePackage)) data.ServicePackage = _toJsonString_(data.ServicePackage);
    if (Array.isArray(data.EquipmentNeed))  data.EquipmentNeed  = _toJsonString_(data.EquipmentNeed);

    // ── Validate status ──
    if (data.PlanStatus && !CARE_PLAN_STATUSES.includes(data.PlanStatus)) {
      return errResult('สถานะไม่ถูกต้อง');
    }

    const r = updateData(SHEET_NAMES.CARE_PLANS, 'CarePlanID', carePlanId, data);
    if (!r.success) return r;

    writeAuditLog('UPDATE', 'careplan', carePlanId,
      { previousStatus: existing.data.PlanStatus },
      { fields: r.data.updatedFields }
    );

    return okResult(null, 'อัปเดต Care Plan สำเร็จ');
  } catch (err) {
    Logger.log('updateCarePlan error: ' + err.stack);
    writeAuditLogFailed_('UPDATE', 'careplan', carePlanId, err.message);
    return errResult('อัปเดตไม่สำเร็จ: ' + err.message);
  }
}

/**
 * approveCarePlan(carePlanId) — อนุมัติ Care Plan (admin/cm)
 * เปลี่ยน status เป็น active + บันทึก ApprovedBy + ApprovedDate
 */
function approveCarePlan(carePlanId) {
  try {
    if (!carePlanId) return errResult('กรุณาระบุ CarePlanID');
    const user = requireAuth_();
    const check = checkPermission(user.role, 'careplan', 'approve');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์อนุมัติ Care Plan');

    const existing = findData(SHEET_NAMES.CARE_PLANS, 'CarePlanID', carePlanId);
    if (!existing.success || !existing.data) return errResult('ไม่พบ Care Plan');

    _checkPatientAccess_(existing.data.PatientID, user);

    if (existing.data.PlanStatus === 'active') return errResult('Care Plan นี้ active อยู่แล้ว');

    const r = updateData(SHEET_NAMES.CARE_PLANS, 'CarePlanID', carePlanId, {
      PlanStatus:   'active',
      ApprovedBy:   user.userId,
      ApprovedDate: formatDateISO(new Date())
    });
    if (!r.success) return r;

    writeAuditLog('APPROVE', 'careplan', carePlanId, null, { approvedBy: user.userId });
    return okResult(null, 'อนุมัติ Care Plan สำเร็จ');
  } catch (err) {
    Logger.log('approveCarePlan error: ' + err.stack);
    writeAuditLogFailed_('APPROVE', 'careplan', carePlanId, err.message);
    return errResult('อนุมัติไม่สำเร็จ: ' + err.message);
  }
}

/**
 * getCarePlanByPatient(patientId) — ดึง Care Plan ทั้งหมดของผู้ป่วย (ทุกสถานะ)
 * เรียงตาม PlanDate ใหม่สุดก่อน
 */
function getCarePlanByPatient(patientId) {
  try {
    if (!patientId) return errResult('กรุณาระบุ PatientID');
    const user = requireAuth_();
    const check = checkPermission(user.role, 'careplan', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดู Care Plan');

    _checkPatientAccess_(patientId, user);

    const result = findAllData(SHEET_NAMES.CARE_PLANS, r => r.PatientID === patientId);
    if (!result.success) return result;

    const sorted = (result.data || [])
      .sort((a, b) => String(b.PlanDate||'').localeCompare(String(a.PlanDate||'')))
      .map(_sanitizeCarePlan_);

    return okResult(sorted, 'พบ ' + sorted.length + ' Care Plan');
  } catch (err) {
    Logger.log('getCarePlanByPatient error: ' + err.stack);
    return errResult('ดึง Care Plan ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * getActiveCarePlan(patientId) — ดึง Care Plan ที่ active อยู่ของผู้ป่วย (รายล่าสุด)
 */
function getActiveCarePlan(patientId) {
  try {
    if (!patientId) return errResult('กรุณาระบุ PatientID');
    const user = requireAuth_();
    const check = checkPermission(user.role, 'careplan', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดู Care Plan');

    _checkPatientAccess_(patientId, user);

    const result = findAllData(SHEET_NAMES.CARE_PLANS,
      r => r.PatientID === patientId && r.PlanStatus === 'active'
    );
    if (!result.success) return result;

    if (!result.data || !result.data.length) {
      return okResult(null, 'ไม่มี Care Plan ที่ active');
    }

    const active = result.data
      .sort((a, b) => String(b.PlanDate||'').localeCompare(String(a.PlanDate||'')))[0];

    return okResult(_sanitizeCarePlan_(active), 'พบ active Care Plan');
  } catch (err) {
    Logger.log('getActiveCarePlan error: ' + err.stack);
    return errResult('ดึง active Care Plan ไม่สำเร็จ: ' + err.message);
  }
}

// ============================================================
// ── HELPERS ─────────────────────────────────────────────────
// ============================================================

/**
 * _toJsonString_(value) — แปลง array/object → JSON string สำหรับเก็บใน Sheet
 * @private
 */
function _toJsonString_(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); }
  catch (e) { return String(value); }
}

// ============================================================
// ── API WRAPPERS ────────────────────────────────────────────
// ============================================================

function api_saveCarePlan(token, data) {
  _CURRENT_TOKEN_ = token;
  try { return saveCarePlan(data); } catch (err) { return errResult(err.message); }
}

function api_updateCarePlan(token, carePlanId, data) {
  _CURRENT_TOKEN_ = token;
  try { return updateCarePlan(carePlanId, data); } catch (err) { return errResult(err.message); }
}

function api_approveCarePlan(token, carePlanId) {
  _CURRENT_TOKEN_ = token;
  try { return approveCarePlan(carePlanId); } catch (err) { return errResult(err.message); }
}

function api_getCarePlanByPatient(token, patientId) {
  _CURRENT_TOKEN_ = token;
  try { return getCarePlanByPatient(patientId); } catch (err) { return errResult(err.message); }
}

function api_getActiveCarePlan(token, patientId) {
  _CURRENT_TOKEN_ = token;
  try { return getActiveCarePlan(patientId); } catch (err) { return errResult(err.message); }
}
