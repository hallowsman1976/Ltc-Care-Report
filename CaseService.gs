/**
 * ============================================================
 * CaseService.gs - Patient (Case) Management
 * ============================================================
 * จัดการข้อมูลผู้รับบริการ (Patient / Case) สำหรับระบบ LTC
 * - CRUD + Search + Timeline
 * - กรองตาม role: admin ดูทั้งหมด / cm ดูเฉพาะที่เป็น CareManager
 *   / cg ดูเฉพาะที่เป็น Caregiver / viewer ดูทั้งหมด (read-only)
 * - คำนวณ Age อัตโนมัติจาก BirthDate
 * - Mask CID เสมอตอนส่ง client
 * - บันทึก Audit Log ทุกครั้งที่ mutate
 * ============================================================
 */

// ============================================================
// ── HELPER: Filter by Role ──────────────────────────────────
// ============================================================

/**
 * _filterByRole_(records, user) — กรองรายการผู้ป่วยตาม role
 * - admin: เห็นทั้งหมด
 * - cm: เห็นเฉพาะ CareManagerID = user.userId
 * - cg: เห็นเฉพาะ CaregiverID = user.userId
 * - viewer: เห็นทั้งหมด (read-only)
 * @private
 */
function _filterByRole_(records, user) {
  if (!user || !records) return [];
  switch (user.role) {
    case 'admin':
    case 'viewer':
      return records;
    case 'cm':
      return records.filter(r => r.CareManagerID === user.userId);
    case 'cg':
      return records.filter(r => r.CaregiverID === user.userId);
    default:
      return [];
  }
}

/**
 * _canAccessPatient_(patient, user) — ตรวจสอบว่า user เข้าถึง patient คนนี้ได้หรือไม่
 * @private
 */
function _canAccessPatient_(patient, user) {
  if (!patient || !user) return false;
  if (user.role === 'admin' || user.role === 'viewer') return true;
  if (user.role === 'cm') return patient.CareManagerID === user.userId;
  if (user.role === 'cg') return patient.CaregiverID === user.userId;
  return false;
}

/**
 * _calculateAge_(birthDate) — คำนวณอายุจากวันเกิด
 * @private
 */
function _calculateAge_(birthDate) {
  try {
    if (!birthDate) return '';
    const d = (birthDate instanceof Date) ? birthDate : new Date(birthDate);
    if (isNaN(d.getTime())) return '';
    const today = new Date();
    let age = today.getFullYear() - d.getFullYear();
    const m = today.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
    return age;
  } catch (e) {
    return '';
  }
}

/**
 * _sanitizePatient_(patient) — เตรียมข้อมูลก่อนส่ง client
 * - Mask CID
 * - แปลง Date → ISO
 * - คำนวณ Age จาก BirthDate (ทุกครั้ง ไม่เชื่อ field Age ที่เก็บไว้)
 * - ลบ __rowIndex
 * @private
 */
function _sanitizePatient_(patient) {
  if (!patient) return null;
  const out = {};
  Object.entries(patient).forEach(([k, v]) => {
    if (k === '__rowIndex') return;
    if (v instanceof Date) { out[k] = v.toISOString(); return; }
    out[k] = v;
  });
  // ── Mask CID เสมอ ──
  if (out.CID) {
    out.CIDMasked = maskCID(out.CID);
    out.CID = maskCID(out.CID); // ไม่ส่ง CID จริงไป client เลย
  }
  // ── คำนวณ Age สดทุกครั้ง ──
  if (out.BirthDate) {
    out.Age = _calculateAge_(out.BirthDate);
  }
  return out;
}

// ============================================================
// ── PATIENT CRUD FUNCTIONS ──────────────────────────────────
// ============================================================

/**
 * getPatients(filters) — ดึงรายการผู้ป่วยตามเงื่อนไข
 * รองรับ filter: { status, careManagerId, caregiverId, dependencyStatus, taiGroup }
 * กรองอัตโนมัติตาม role ของ user ที่ login อยู่
 * @param {Object} [filters]
 * @returns {Object} {success, data: [...], message}
 */
function getPatients(filters) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'patient', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูข้อมูลผู้ป่วย');

    const result = findAllData(SHEET_NAMES.PATIENTS);
    if (!result.success) return result;

    let records = result.data || [];

    // ── กรอง soft-deleted (Status = 'inactive' หรือ 'deleted') ──
    records = records.filter(r => {
      const s = String(r.Status || '').toLowerCase();
      return s !== 'deleted' && s !== 'inactive';
    });

    // ── กรองตาม role ──
    records = _filterByRole_(records, user);

    // ── กรองตาม filters เพิ่มเติม ──
    if (filters && typeof filters === 'object') {
      if (filters.status) {
        records = records.filter(r => r.Status === filters.status);
      }
      if (filters.careManagerId) {
        records = records.filter(r => r.CareManagerID === filters.careManagerId);
      }
      if (filters.caregiverId) {
        records = records.filter(r => r.CaregiverID === filters.caregiverId);
      }
      if (filters.dependencyStatus) {
        records = records.filter(r => r.DependencyStatus === filters.dependencyStatus);
      }
      if (filters.taiGroup) {
        records = records.filter(r => r.TAIGroup === filters.taiGroup);
      }
    }

    const sanitized = records.map(_sanitizePatient_);
    return okResult(sanitized, 'พบ ' + sanitized.length + ' ราย');
  } catch (err) {
    Logger.log('getPatients error: ' + err.stack);
    return errResult('ดึงข้อมูลผู้ป่วยไม่สำเร็จ: ' + err.message);
  }
}

/**
 * getPatientById(patientId) — ดึงข้อมูลผู้ป่วยรายเดียว
 * @param {string} patientId
 * @returns {Object} {success, data, message}
 */
function getPatientById(patientId) {
  try {
    if (!patientId) return errResult('กรุณาระบุ PatientID');
    const user = requireAuth_();
    const check = checkPermission(user.role, 'patient', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูข้อมูลผู้ป่วย');

    const result = findData(SHEET_NAMES.PATIENTS, 'PatientID', patientId);
    if (!result.success || !result.data) return errResult('ไม่พบผู้ป่วย: ' + patientId);

    if (!_canAccessPatient_(result.data, user)) {
      return errResult('ไม่มีสิทธิ์ดูข้อมูลผู้ป่วยรายนี้');
    }

    return okResult(_sanitizePatient_(result.data), 'พบข้อมูล');
  } catch (err) {
    Logger.log('getPatientById error: ' + err.stack);
    return errResult('ดึงข้อมูลไม่สำเร็จ: ' + err.message);
  }
}

/**
 * savePatient(data) — เพิ่มผู้ป่วยใหม่ (admin/cm เท่านั้น)
 * Validate CID (ถ้ามี), Generate PatientID, Set defaults
 * @param {Object} data - ข้อมูลผู้ป่วย (field names ตาม schema)
 * @returns {Object} {success, data: {patientId}, message}
 */
function savePatient(data) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'patient', 'create');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์เพิ่มผู้ป่วย');

    if (!data || typeof data !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');

    // ── Validate required fields ──
    if (!data.FullName) return errResult('กรุณากรอกชื่อ-นามสกุล');
    if (!data.Sex) return errResult('กรุณาเลือกเพศ');

    // ── Validate CID ถ้ามี ──
    if (data.CID) {
      const cidCheck = validateCID(data.CID);
      if (!cidCheck.data || !cidCheck.data.valid) {
        return errResult(cidCheck.message || 'เลขบัตรประชาชนไม่ถูกต้อง');
      }
      // ── ตรวจซ้ำ ──
      const dup = findData(SHEET_NAMES.PATIENTS, 'CID', String(data.CID).replace(/\D/g,''));
      if (dup.success && dup.data) {
        return errResult('มีผู้ป่วยที่ใช้เลขบัตรประชาชนนี้แล้วในระบบ');
      }
    }

    // ── เตรียม record ──
    const patientId = generateId('PT');
    const now = new Date().toISOString();
    const record = {
      PatientID:           patientId,
      CID:                 data.CID ? String(data.CID).replace(/\D/g,'') : '',
      HN:                  data.HN || '',
      FullName:            data.FullName,
      Sex:                 data.Sex,
      BirthDate:           data.BirthDate || '',
      Age:                 data.BirthDate ? _calculateAge_(data.BirthDate) : (data.Age || ''),
      Phone:               data.Phone || '',
      Address:             data.Address || '',
      VillageNo:           data.VillageNo || '',
      VillageName:         data.VillageName || '',
      Subdistrict:         data.Subdistrict || '',
      District:            data.District || '',
      Province:            data.Province || '',
      Latitude:            data.Latitude || '',
      Longitude:           data.Longitude || '',
      MainCaregiverName:   data.MainCaregiverName || '',
      MainCaregiverPhone:  data.MainCaregiverPhone || '',
      Relationship:        data.Relationship || '',
      RightType:           data.RightType || '',
      Disease:             data.Disease || '',
      DependencyStatus:    data.DependencyStatus || '',
      ADLScore:            data.ADLScore || '',
      TAIGroup:            data.TAIGroup || '',
      PPSScore:            data.PPSScore || '',
      MentalHealthStatus:  data.MentalHealthStatus || '',
      CareManagerID:       data.CareManagerID || (user.role === 'cm' ? user.userId : ''),
      CaregiverID:         data.CaregiverID || '',
      RegisterDate:        data.RegisterDate || formatDateISO(new Date()),
      Status:              data.Status || 'active',
      CreatedBy:           user.userId,
      CreatedAt:           now,
      UpdatedAt:           ''
    };

    const r = appendData(SHEET_NAMES.PATIENTS, record);
    if (!r.success) return r;

    // ── Audit Log ──
    writeAuditLog('CREATE', 'patient', patientId, null, {
      fullName: data.FullName,
      hasCID: !!data.CID,
      careManagerId: record.CareManagerID,
      caregiverId: record.CaregiverID
    });

    return okResult({ patientId }, 'เพิ่มผู้ป่วยสำเร็จ');
  } catch (err) {
    Logger.log('savePatient error: ' + err.stack);
    writeAuditLogFailed_('CREATE', 'patient', '', err.message);
    return errResult('เพิ่มผู้ป่วยไม่สำเร็จ: ' + err.message);
  }
}

/**
 * updatePatient(patientId, data) — อัปเดตข้อมูลผู้ป่วย
 * @param {string} patientId
 * @param {Object} data
 * @returns {Object} {success, data, message}
 */
function updatePatient(patientId, data) {
  try {
    if (!patientId) return errResult('กรุณาระบุ PatientID');
    if (!data || typeof data !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');

    const user = requireAuth_();
    const check = checkPermission(user.role, 'patient', 'update');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์แก้ไขผู้ป่วย');

    // ── ดึง record เดิม ──
    const existing = findData(SHEET_NAMES.PATIENTS, 'PatientID', patientId);
    if (!existing.success || !existing.data) return errResult('ไม่พบผู้ป่วย: ' + patientId);

    // ── ตรวจสิทธิ์เข้าถึง ──
    if (!_canAccessPatient_(existing.data, user)) {
      return errResult('ไม่มีสิทธิ์แก้ไขผู้ป่วยรายนี้');
    }

    // ── ห้ามแก้ไขฟิลด์สงวน ──
    const protectedFields = ['PatientID','CreatedBy','CreatedAt'];
    protectedFields.forEach(f => delete data[f]);

    // ── Validate CID ใหม่ (ถ้าเปลี่ยน) ──
    if (data.CID && String(data.CID).replace(/\D/g,'') !== existing.data.CID) {
      const cidCheck = validateCID(data.CID);
      if (!cidCheck.data || !cidCheck.data.valid) {
        return errResult(cidCheck.message || 'เลขบัตรประชาชนไม่ถูกต้อง');
      }
      data.CID = String(data.CID).replace(/\D/g,'');
    }

    // ── คำนวณ Age ใหม่ถ้าเปลี่ยน BirthDate ──
    if (data.BirthDate) data.Age = _calculateAge_(data.BirthDate);

    // ── บันทึก ──
    const r = updateData(SHEET_NAMES.PATIENTS, 'PatientID', patientId, data);
    if (!r.success) return r;

    // ── Audit Log ──
    writeAuditLog('UPDATE', 'patient', patientId,
      { fields: Object.keys(data) },
      { updatedFields: r.data.updatedFields }
    );

    return okResult(null, 'อัปเดตข้อมูลสำเร็จ');
  } catch (err) {
    Logger.log('updatePatient error: ' + err.stack);
    writeAuditLogFailed_('UPDATE', 'patient', patientId, err.message);
    return errResult('อัปเดตไม่สำเร็จ: ' + err.message);
  }
}

/**
 * deletePatient(patientId) — Soft delete (Status = 'deleted')
 * เฉพาะ admin เท่านั้น
 * @param {string} patientId
 * @returns {Object}
 */
function deletePatient(patientId) {
  try {
    if (!patientId) return errResult('กรุณาระบุ PatientID');
    const user = requireAuth_();
    const check = checkPermission(user.role, 'patient', 'delete');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ลบผู้ป่วย (เฉพาะ admin)');

    const existing = findData(SHEET_NAMES.PATIENTS, 'PatientID', patientId);
    if (!existing.success || !existing.data) return errResult('ไม่พบผู้ป่วย: ' + patientId);

    const r = updateData(SHEET_NAMES.PATIENTS, 'PatientID', patientId, { Status: 'deleted' });
    if (!r.success) return r;

    writeAuditLog('DELETE', 'patient', patientId,
      { status: existing.data.Status, fullName: existing.data.FullName },
      { status: 'deleted' }
    );

    return okResult(null, 'ลบผู้ป่วยสำเร็จ (soft delete)');
  } catch (err) {
    Logger.log('deletePatient error: ' + err.stack);
    writeAuditLogFailed_('DELETE', 'patient', patientId, err.message);
    return errResult('ลบไม่สำเร็จ: ' + err.message);
  }
}

/**
 * searchPatients(keyword) — ค้นหาผู้ป่วยจาก keyword
 * ค้นจาก: FullName, HN, Phone, Address, VillageName, CID (เฉพาะ 4 ตัวท้าย)
 * @param {string} keyword
 * @returns {Object}
 */
function searchPatients(keyword) {
  try {
    if (!keyword || !String(keyword).trim()) {
      return okResult([], 'กรุณาใส่คำค้น');
    }
    const user = requireAuth_();
    const check = checkPermission(user.role, 'patient', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ค้นหาผู้ป่วย');

    const result = findAllData(SHEET_NAMES.PATIENTS);
    if (!result.success) return result;

    let records = (result.data || []).filter(r => {
      const s = String(r.Status || '').toLowerCase();
      return s !== 'deleted';
    });

    // ── กรองตาม role ──
    records = _filterByRole_(records, user);

    const q = String(keyword).trim().toLowerCase();
    const matches = records.filter(r => {
      const cid = String(r.CID || '').replace(/\D/g, '');
      return (
        (r.FullName    && String(r.FullName).toLowerCase().includes(q)) ||
        (r.HN          && String(r.HN).toLowerCase().includes(q)) ||
        (r.Phone       && String(r.Phone).replace(/\D/g,'').includes(q.replace(/\D/g,''))) ||
        (r.Address     && String(r.Address).toLowerCase().includes(q)) ||
        (r.VillageName && String(r.VillageName).toLowerCase().includes(q)) ||
        (cid.length === 13 && cid.slice(-4).includes(q))
      );
    });

    return okResult(matches.map(_sanitizePatient_), 'พบ ' + matches.length + ' ราย');
  } catch (err) {
    Logger.log('searchPatients error: ' + err.stack);
    return errResult('ค้นหาไม่สำเร็จ: ' + err.message);
  }
}

/**
 * getPatientTimeline(patientId) — รวมประวัติทั้งหมดของผู้ป่วยเรียงตามเวลา
 * รวม: CarePlan, Visits, VitalSigns, ADL, PPSA, MentalHealth, BenefitReports
 * @param {string} patientId
 * @returns {Object} {success, data: {patient, timeline: [...]}, message}
 */
function getPatientTimeline(patientId) {
  try {
    if (!patientId) return errResult('กรุณาระบุ PatientID');
    const user = requireAuth_();
    const check = checkPermission(user.role, 'patient', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูประวัติผู้ป่วย');

    const patientResult = findData(SHEET_NAMES.PATIENTS, 'PatientID', patientId);
    if (!patientResult.success || !patientResult.data) return errResult('ไม่พบผู้ป่วย');
    if (!_canAccessPatient_(patientResult.data, user)) {
      return errResult('ไม่มีสิทธิ์ดูข้อมูลผู้ป่วยรายนี้');
    }

    const timeline = [];

    // ── 1. Care Plans ──
    const cps = findAllData(SHEET_NAMES.CARE_PLANS, r => r.PatientID === patientId);
    if (cps.success) {
      cps.data.forEach(cp => timeline.push({
        type: 'careplan',
        id: cp.CarePlanID,
        date: cp.PlanDate,
        title: 'Care Plan',
        summary: cp.GoalOfCare || '',
        status: cp.PlanStatus,
        record: cp
      }));
    }

    // ── 2. Visits ──
    const visits = findAllData(SHEET_NAMES.VISITS, r => r.PatientID === patientId);
    if (visits.success) {
      visits.data.forEach(v => timeline.push({
        type: 'visit',
        id: v.VisitID,
        date: v.VisitDate,
        title: 'เยี่ยมบ้านครั้งที่ ' + v.VisitNo,
        summary: v.MainProblem || v.VisitSummary || '',
        visitorName: v.VisitorName,
        record: v
      }));
    }

    // ── 3. Vital Signs ──
    const vitals = findAllData(SHEET_NAMES.VITAL_SIGNS, r => r.PatientID === patientId);
    if (vitals.success) {
      vitals.data.forEach(vs => timeline.push({
        type: 'vital',
        id: vs.VitalSignID,
        date: vs.MeasuredDate,
        title: 'วัดสัญญาณชีพ',
        summary: 'BP: ' + (vs.BPSystolic||'-') + '/' + (vs.BPDiastolic||'-') +
                 ' BMI: ' + (vs.BMI||'-'),
        record: vs
      }));
    }

    // ── 4. ADL ──
    const adls = findAllData(SHEET_NAMES.ADL, r => r.PatientID === patientId);
    if (adls.success) {
      adls.data.forEach(a => timeline.push({
        type: 'adl',
        id: a.ADLAssessmentID,
        date: a.AssessedDate,
        title: 'ประเมิน ADL',
        summary: 'คะแนน: ' + (a.TotalScore||'-') + ' (' + (a.ADLLevel||'') + ')',
        record: a
      }));
    }

    // ── 5. PPSA ──
    const ppsas = findAllData(SHEET_NAMES.PPSA, r => r.PatientID === patientId);
    if (ppsas.success) {
      ppsas.data.forEach(p => timeline.push({
        type: 'ppsa',
        id: p.PPSAAssessmentID,
        date: p.AssessedDate,
        title: 'ประเมิน PPS',
        summary: 'PPS: ' + (p.PPSScore||'-') + '% (' + (p.CareCategory||'') + ')',
        record: p
      }));
    }

    // ── 6. Mental Health ──
    const mh = findAllData(SHEET_NAMES.MENTAL_HEALTH, r => r.PatientID === patientId);
    if (mh.success) {
      mh.data.forEach(m => timeline.push({
        type: 'mental',
        id: m.ScreeningID,
        date: m.ScreenedDate,
        title: 'คัดกรองสุขภาพจิต (' + m.ScreeningType + ')',
        summary: 'คะแนน: ' + (m.TotalScore||'-') + ' - ' + (m.InterpretationLevel||''),
        record: m
      }));
    }

    // ── 7. Benefit Reports ──
    const bens = findAllData(SHEET_NAMES.BENEFIT_REPORT, r => r.PatientID === patientId);
    if (bens.success) {
      bens.data.forEach(b => timeline.push({
        type: 'benefit',
        id: b.ReportID,
        date: b.CreatedAt,
        title: 'รายงานบริการ ' + (b.ReportPeriod||''),
        summary: 'จำนวนบริการ: ' + (b.TotalServicesProvided||0),
        status: b.ReportStatus,
        record: b
      }));
    }

    // ── เรียงเวลาใหม่สุดก่อน ──
    timeline.sort((a, b) => String(b.date||'').localeCompare(String(a.date||'')));

    return okResult({
      patient: _sanitizePatient_(patientResult.data),
      timeline,
      totalEvents: timeline.length
    }, 'ดึงประวัติสำเร็จ');
  } catch (err) {
    Logger.log('getPatientTimeline error: ' + err.stack);
    return errResult('ดึงประวัติไม่สำเร็จ: ' + err.message);
  }
}

// ============================================================
// ── API WRAPPERS (Client-Callable) ──────────────────────────
// ============================================================

/** API: ดึงรายการผู้ป่วย */
function api_getPatients(token, filters) {
  _CURRENT_TOKEN_ = token;
  try { return getPatients(filters); }
  catch (err) { return errResult(err.message); }
}

/** API: ดึงรายผู้ป่วย */
function api_getPatientById(token, patientId) {
  _CURRENT_TOKEN_ = token;
  try { return getPatientById(patientId); }
  catch (err) { return errResult(err.message); }
}

/** API: เพิ่มผู้ป่วย */
function api_savePatient(token, data) {
  _CURRENT_TOKEN_ = token;
  try { return savePatient(data); }
  catch (err) { return errResult(err.message); }
}

/** API: อัปเดตผู้ป่วย */
function api_updatePatient(token, patientId, data) {
  _CURRENT_TOKEN_ = token;
  try { return updatePatient(patientId, data); }
  catch (err) { return errResult(err.message); }
}

/** API: ลบผู้ป่วย (soft) */
function api_deletePatient(token, patientId) {
  _CURRENT_TOKEN_ = token;
  try { return deletePatient(patientId); }
  catch (err) { return errResult(err.message); }
}

/** API: ค้นหาผู้ป่วย */
function api_searchPatients(token, keyword) {
  _CURRENT_TOKEN_ = token;
  try { return searchPatients(keyword); }
  catch (err) { return errResult(err.message); }
}

/** API: ดึง Timeline ผู้ป่วย */
function api_getPatientTimeline(token, patientId) {
  _CURRENT_TOKEN_ = token;
  try { return getPatientTimeline(patientId); }
  catch (err) { return errResult(err.message); }
}

// ============================================================
// ── DASHBOARD AGGREGATOR ────────────────────────────────────
// ============================================================

/**
 * api_getDashboardData(token, filters) — รวมสถิติทั้งหมดสำหรับ Dashboard
 * รวบรวมจริงจากข้อมูลใน Sheet ไม่ใช้ mock data
 * @param {string} token
 * @param {Object} [filters] - {dateFrom, dateTo, village, careManagerId, caregiverId, status}
 */
function api_getDashboardData(token, filters) {
  _CURRENT_TOKEN_ = token;
  try {
    const user = requireAuth_();
    const f = filters || {};

    // ── ดึงผู้ป่วยทั้งหมด (กรองตาม role อัตโนมัติ) ──
    const patientsResult = findAllData(SHEET_NAMES.PATIENTS, r => {
      const s = String(r.Status || '').toLowerCase();
      return s !== 'deleted';
    });
    if (!patientsResult.success) return patientsResult;

    let patients = _filterByRole_(patientsResult.data || [], user);

    // ── apply user filters ──
    if (f.village)         patients = patients.filter(p => p.VillageName === f.village || p.VillageNo == f.village);
    if (f.careManagerId)   patients = patients.filter(p => p.CareManagerID === f.careManagerId);
    if (f.caregiverId)     patients = patients.filter(p => p.CaregiverID === f.caregiverId);
    if (f.status)          patients = patients.filter(p => p.Status === f.status);

    const patientIds = new Set(patients.map(p => p.PatientID));

    // ── ดึง visits ของ patient ที่เห็น ──
    const visitsResult = findAllData(SHEET_NAMES.VISITS, r => patientIds.has(r.PatientID));
    let visits = visitsResult.success ? (visitsResult.data || []) : [];

    if (f.dateFrom || f.dateTo) {
      visits = visits.filter(v => {
        const d = String(v.VisitDate || '').split('T')[0];
        if (f.dateFrom && d < f.dateFrom) return false;
        if (f.dateTo   && d > f.dateTo)   return false;
        return true;
      });
    }

    // ── ดึง care plans ──
    const cpResult = findAllData(SHEET_NAMES.CARE_PLANS, r => patientIds.has(r.PatientID));
    const carePlans = cpResult.success ? (cpResult.data || []) : [];

    // ────────────────────────────────────────────────────────
    // ── คำนวณการ์ดสรุป 8 ใบ ──
    // ────────────────────────────────────────────────────────
    const today = formatDateISO(new Date());
    const thisMonth = today.substring(0, 7); // yyyy-MM

    const isDependent = (p) => {
      const s = parseInt(p.ADLScore);
      return !isNaN(s) && s <= 11;
    };
    const calcAge = (p) => _calculateAge_(p.BirthDate);

    const totalCases       = patients.length;
    const elderlyDependent = patients.filter(p => isDependent(p) && calcAge(p) >= 60).length;
    const otherDependent   = patients.filter(p => isDependent(p) && calcAge(p) < 60).length;
    const visitsThisMonth  = visits.filter(v => String(v.VisitDate||'').startsWith(thisMonth)).length;

    // ── nearing/overdue: คำนวณจาก NextVisitDate ของ visit ล่าสุดต่อ patient ──
    const latestByPatient = {};
    visits.forEach(v => {
      const cur = latestByPatient[v.PatientID];
      if (!cur || (parseInt(v.VisitNo)||0) > (parseInt(cur.VisitNo)||0)) {
        latestByPatient[v.PatientID] = v;
      }
    });
    const in7 = formatDateISO(new Date(Date.now() + 7*86400000));
    let nearingVisitCount = 0, overdueCount = 0;
    Object.values(latestByPatient).forEach(v => {
      const next = String(v.NextVisitDate||'').split('T')[0];
      if (!next) return;
      if (next < today) overdueCount++;
      else if (next <= in7) nearingVisitCount++;
    });

    // ── high-risk mental: จาก MentalHealthStatus ที่มีคำว่า 'รุนแรง' / 'high' ──
    const highRiskMental = patients.filter(p => {
      const s = String(p.MentalHealthStatus || '').toLowerCase();
      return s.includes('รุนแรง') || s.includes('high') || s.includes('ปานกลาง');
    }).length;

    // ── palliative: PPSScore <= 30 ──
    const palliativeCount = patients.filter(p => {
      const s = parseInt(p.PPSScore);
      return !isNaN(s) && s <= 30;
    }).length;

    // ────────────────────────────────────────────────────────
    // ── กราฟ/สรุป ──
    // ────────────────────────────────────────────────────────

    // (1) จำนวนเคสตามหมู่บ้าน
    const byVillage = {};
    patients.forEach(p => {
      const v = p.VillageName || ('ม.' + (p.VillageNo||'?'));
      byVillage[v] = (byVillage[v] || 0) + 1;
    });
    const villageStats = Object.entries(byVillage)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // (2) จำนวนเคสตาม ADL/TAI Group
    const byTai = { 'กลุ่ม 1':0, 'กลุ่ม 2':0, 'กลุ่ม 3':0, 'กลุ่ม 4':0, 'ไม่ระบุ':0 };
    patients.forEach(p => {
      const tg = String(p.TAIGroup || '');
      let key = 'ไม่ระบุ';
      if (tg.includes('กลุ่ม 1')) key = 'กลุ่ม 1';
      else if (tg.includes('กลุ่ม 2')) key = 'กลุ่ม 2';
      else if (tg.includes('กลุ่ม 3')) key = 'กลุ่ม 3';
      else if (tg.includes('กลุ่ม 4')) key = 'กลุ่ม 4';
      byTai[key]++;
    });

    // (3) แนวโน้มการเยี่ยมรายเดือน (12 เดือนล่าสุด)
    const monthlyVisits = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
      monthlyVisits[key] = 0;
    }
    visits.forEach(v => {
      const m = String(v.VisitDate||'').substring(0, 7);
      if (m in monthlyVisits) monthlyVisits[m]++;
    });
    const monthlyTrend = Object.entries(monthlyVisits).map(([month, count]) => ({ month, count }));

    // (4) สถานะ Care Plan
    const planStatusCount = { draft:0, active:0, completed:0, cancelled:0 };
    carePlans.forEach(cp => {
      const s = String(cp.PlanStatus || 'draft').toLowerCase();
      if (s in planStatusCount) planStatusCount[s]++;
    });

    // ── รายชื่อ caregivers / care managers สำหรับ filter dropdown ──
    const usersResult = findAllData(SHEET_NAMES.USERS, u => {
      const active = u.IsActive === true || u.IsActive === 'true' || u.IsActive === 'TRUE';
      return active && (u.Role === 'cm' || u.Role === 'cg');
    });
    const caregivers = usersResult.success ? usersResult.data
      .map(u => ({ userId: u.UserID, fullName: u.FullName, role: u.Role })) : [];

    // ── หมู่บ้านที่มีในระบบ ──
    const villages = [...new Set(patients
      .map(p => p.VillageName || (p.VillageNo ? 'ม.' + p.VillageNo : ''))
      .filter(v => v))]
      .sort();

    return okResult({
      cards: {
        totalCases,
        elderlyDependent,
        otherDependent,
        visitsThisMonth,
        nearingVisitCount,
        overdueCount,
        highRiskMental,
        palliativeCount
      },
      charts: {
        byVillage: villageStats,
        byTaiGroup: Object.entries(byTai).map(([group, count]) => ({ group, count })),
        monthlyTrend,
        planStatus: Object.entries(planStatusCount).map(([status, count]) => ({ status, count }))
      },
      filterOptions: {
        villages,
        caregivers
      },
      user: {
        role: user.role,
        fullName: user.fullName
      },
      generatedAt: new Date().toISOString()
    }, 'Dashboard data');
  } catch (err) {
    Logger.log('api_getDashboardData error: ' + err.stack);
    return errResult('ดึงข้อมูล Dashboard ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * api_assignCaregiver(token, caregiverId, patientIds) — มอบหมายผู้สูงอายุให้ CG (admin/cm)
 * sync แบบรวม: patient ใน patientIds → CaregiverID = caregiverId,
 *   ส่วน patient ที่เคยเป็นของ CG นี้แต่ไม่อยู่ในลิสต์ → ปลดออก (CaregiverID = '')
 * @param {string} token
 * @param {string} caregiverId - UserID ของ CG
 * @param {string[]} patientIds - รายการ PatientID ที่ต้องการให้ CG นี้ดูแล
 */
function api_assignCaregiver(token, caregiverId, patientIds) {
  _CURRENT_TOKEN_ = token;
  try {
    requirePermission_(token, 'patient', 'update');
    if (!caregiverId) return errResult('กรุณาเลือกผู้ดูแล (CG)');

    const ids = Array.isArray(patientIds) ? patientIds : [];
    const all = findAllData(SHEET_NAMES.PATIENTS);
    if (!all.success) return all;

    let assigned = 0, removed = 0;
    (all.data || []).forEach(p => {
      const status = String(p.Status || '').toLowerCase();
      if (status === 'deleted' || status === 'inactive') return;
      const want = ids.indexOf(p.PatientID) !== -1;
      const isThis = p.CaregiverID === caregiverId;
      if (want && !isThis) {
        updateData(SHEET_NAMES.PATIENTS, 'PatientID', p.PatientID, { CaregiverID: caregiverId });
        assigned++;
      } else if (!want && isThis) {
        updateData(SHEET_NAMES.PATIENTS, 'PatientID', p.PatientID, { CaregiverID: '' });
        removed++;
      }
    });

    writeAuditLog('UPDATE', 'patient', caregiverId, null,
      { action: 'assignCaregiver', caregiverId, assigned, removed });
    return okResult({ assigned, removed },
      'มอบหมายสำเร็จ — เพิ่ม ' + assigned + ' ราย, ปลด ' + removed + ' ราย');
  } catch (err) {
    Logger.log('api_assignCaregiver error: ' + err.stack);
    return errResult(err.message);
  }
}

/**
 * api_assignStaff(token, kind, staffId, patientIds) — มอบหมายผู้ป่วยให้ CG หรือ CM (admin/cm)
 * @param {string} kind - 'cg' (CaregiverID) หรือ 'cm' (CareManagerID)
 * @param {string} staffId - UserID
 * @param {string[]} patientIds - รายการ PatientID ที่ให้ staff คนนี้รับผิดชอบ (sync แบบรวม)
 */
function api_assignStaff(token, kind, staffId, patientIds) {
  _CURRENT_TOKEN_ = token;
  try {
    requirePermission_(token, 'patient', 'update');
    const field = kind === 'cm' ? 'CareManagerID' : 'CaregiverID';
    if (!staffId) return errResult('กรุณาเลือกผู้รับผิดชอบ');

    const ids = Array.isArray(patientIds) ? patientIds : [];
    const all = findAllData(SHEET_NAMES.PATIENTS);
    if (!all.success) return all;

    let assigned = 0, removed = 0;
    (all.data || []).forEach(p => {
      const status = String(p.Status || '').toLowerCase();
      if (status === 'deleted' || status === 'inactive') return;
      const want = ids.indexOf(p.PatientID) !== -1;
      const isThis = p[field] === staffId;
      const patch = {};
      if (want && !isThis) { patch[field] = staffId; updateData(SHEET_NAMES.PATIENTS, 'PatientID', p.PatientID, patch); assigned++; }
      else if (!want && isThis) { patch[field] = ''; updateData(SHEET_NAMES.PATIENTS, 'PatientID', p.PatientID, patch); removed++; }
    });

    writeAuditLog('UPDATE', 'patient', staffId, null, { action: 'assignStaff', kind, staffId, assigned, removed });
    return okResult({ assigned, removed },
      'มอบหมายสำเร็จ — เพิ่ม ' + assigned + ' ราย, ปลด ' + removed + ' ราย');
  } catch (err) {
    Logger.log('api_assignStaff error: ' + err.stack);
    return errResult(err.message);
  }
}
