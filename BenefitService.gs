/**
 * ============================================================
 * BenefitService.gs - LTC Benefit Package Reports
 * ============================================================
 * บันทึกรายงานบริการตาม NHSO LTC Benefit Package
 * - 15 รายการบริการมาตรฐาน (5 หมวด)
 * - Upsert: PatientID + FiscalYear + ReportMonth = unique
 * - Audit Log ทุกครั้ง
 * ============================================================
 */

// ── 15 รายการบริการ LTC Benefit Package (ค่าเริ่มต้น) ──
const LTC_BENEFIT_ITEMS = [
  // หมวด 1: การประเมินและวางแผน
  { id:'B01', name:'การประเมินผู้ป่วยและวางแผนการดูแล', group:'การประเมินและวางแผน', unit:'ครั้ง' },
  { id:'B02', name:'การทบทวนแผนการดูแลและประเมินซ้ำ',  group:'การประเมินและวางแผน', unit:'ครั้ง' },
  // หมวด 2: การดูแลพื้นฐาน
  { id:'B03', name:'การตรวจวัดสัญญาณชีพ',                group:'การดูแลพื้นฐาน',     unit:'ครั้ง' },
  { id:'B04', name:'การดูแลสุขอนามัยส่วนบุคคล',        group:'การดูแลพื้นฐาน',     unit:'ครั้ง' },
  { id:'B05', name:'การดูแลโภชนาการและให้อาหาร',       group:'การดูแลพื้นฐาน',     unit:'ครั้ง' },
  { id:'B06', name:'การเปลี่ยนผ้าอ้อม / ขับถ่าย',       group:'การดูแลพื้นฐาน',     unit:'ครั้ง' },
  // หมวด 3: การดูแลทางการแพทย์
  { id:'B07', name:'การให้ยาตามแผนการรักษา',           group:'การดูแลทางการแพทย์', unit:'ครั้ง' },
  { id:'B08', name:'การดูแลแผล / แผลกดทับ',             group:'การดูแลทางการแพทย์', unit:'ครั้ง' },
  { id:'B09', name:'การดูแลสายต่างๆ (NG, Foley, Trach)', group:'การดูแลทางการแพทย์', unit:'ครั้ง' },
  // หมวด 4: ฟื้นฟูสมรรถภาพ
  { id:'B10', name:'กายภาพบำบัด / ฟื้นฟูการเคลื่อนไหว', group:'ฟื้นฟูสมรรถภาพ',     unit:'ครั้ง' },
  { id:'B11', name:'กิจกรรมบำบัดและส่งเสริม ADL',       group:'ฟื้นฟูสมรรถภาพ',     unit:'ครั้ง' },
  // หมวด 5: สุขภาพจิตและสังคม
  { id:'B12', name:'การดูแลสุขภาพจิตและให้คำปรึกษา',    group:'สุขภาพจิตและสังคม',  unit:'ครั้ง' },
  { id:'B13', name:'การส่งเสริมการมีส่วนร่วมของครอบครัว', group:'สุขภาพจิตและสังคม', unit:'ครั้ง' },
  { id:'B14', name:'การให้สุขศึกษาผู้ดูแลและญาติ',      group:'สุขภาพจิตและสังคม',  unit:'ครั้ง' },
  { id:'B15', name:'การประสานส่งต่อและจัดหาอุปกรณ์',    group:'สุขภาพจิตและสังคม',  unit:'ครั้ง' },
];

/**
 * api_getBenefitItems(token) — ดึงรายการบริการ LTC ทั้งหมด
 */
function api_getBenefitItems(token) {
  _CURRENT_TOKEN_ = token;
  try {
    requireAuth_();
    return okResult({
      items: LTC_BENEFIT_ITEMS,
      groups: [...new Set(LTC_BENEFIT_ITEMS.map(i => i.group))]
    }, 'รายการบริการ LTC');
  } catch (err) {
    return errResult(err.message);
  }
}

/**
 * api_saveBenefitReport(token, data) — บันทึก/อัปเดตรายงานบริการ (upsert)
 * @param {string} token
 * @param {Object} data - { PatientID, FiscalYear, ReportMonth, ServiceItems[],
 *                          CarePlanID?, Notes? }
 *   ServiceItems = [{id, name, group, quantity, provider, notes}]
 */
function api_saveBenefitReport(token, data) {
  _CURRENT_TOKEN_ = token;
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'benefit', 'create');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์บันทึกรายงานบริการ');

    if (!data || typeof data !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');
    if (!data.PatientID)   return errResult('ต้องระบุ PatientID');
    if (!data.FiscalYear)  return errResult('ต้องระบุ FiscalYear (ค.ศ.)');
    if (!data.ReportMonth) return errResult('ต้องระบุ ReportMonth (1-12)');

    const month = parseInt(data.ReportMonth);
    if (isNaN(month) || month < 1 || month > 12) return errResult('ReportMonth ต้องเป็น 1-12');

    if (!Array.isArray(data.ServiceItems) || !data.ServiceItems.length) {
      return errResult('กรุณาเลือกรายการบริการอย่างน้อย 1 รายการ');
    }

    // ── ตรวจสิทธิ์ผู้ป่วย ──
    const p = findData(SHEET_NAMES.PATIENTS, 'PatientID', data.PatientID);
    if (!p.success || !p.data) return errResult('ไม่พบผู้ป่วย');
    if (user.role === 'cm' && p.data.CareManagerID !== user.userId) return errResult('ไม่มีสิทธิ์ผู้ป่วยรายนี้');
    if (user.role === 'cg' && p.data.CaregiverID   !== user.userId) return errResult('ไม่มีสิทธิ์ผู้ป่วยรายนี้');

    // ── ตรวจซ้ำตาม PatientID + FiscalYear + Month ──
    const existing = findAllData(SHEET_NAMES.BENEFIT_REPORT, r =>
      r.PatientID === data.PatientID &&
      String(r.FiscalYear) === String(data.FiscalYear) &&
      String(r.ReportMonth) === String(month)
    );

    const period = String(data.FiscalYear) + '-' + String(month).padStart(2, '0');
    const totalServices = data.ServiceItems.length;
    const now = new Date().toISOString();

    if (existing.success && existing.data && existing.data.length > 0) {
      // ── UPDATE ──
      const reportId = existing.data[0].ReportID;
      const r = updateData(SHEET_NAMES.BENEFIT_REPORT, 'ReportID', reportId, {
        CarePlanID:             data.CarePlanID || existing.data[0].CarePlanID || '',
        ServiceItems:           JSON.stringify(data.ServiceItems),
        TotalServicesProvided:  totalServices,
        TotalVisitsThisMonth:   data.TotalVisitsThisMonth || '',
        ReportStatus:           data.ReportStatus || 'draft',
        ReportedBy:             user.userId,
        Notes:                  data.Notes || ''
      });
      if (!r.success) return r;
      writeAuditLog('UPDATE', 'benefit', reportId, null, { patientId: data.PatientID, period, totalServices });
      return okResult({ reportId, action: 'updated', period }, 'อัปเดตรายงานบริการสำเร็จ');
    }

    // ── INSERT ──
    const reportId = generateId('RPT');
    const record = {
      ReportID:               reportId,
      PatientID:              data.PatientID,
      CarePlanID:             data.CarePlanID || '',
      FiscalYear:             data.FiscalYear,
      ReportMonth:            month,
      ReportPeriod:           period,
      ServiceItems:           JSON.stringify(data.ServiceItems),
      TotalServicesProvided:  totalServices,
      TotalVisitsThisMonth:   data.TotalVisitsThisMonth || '',
      ReportStatus:           data.ReportStatus || 'draft',
      ReportedBy:             user.userId,
      SubmittedAt:            '',
      ApprovedBy:             '',
      ApprovedAt:             '',
      Notes:                  data.Notes || '',
      CreatedAt:              now,
      UpdatedAt:              ''
    };
    const r = appendData(SHEET_NAMES.BENEFIT_REPORT, record);
    if (!r.success) return r;
    writeAuditLog('CREATE', 'benefit', reportId, null, { patientId: data.PatientID, period, totalServices });
    return okResult({ reportId, action: 'created', period }, 'บันทึกรายงานบริการสำเร็จ');
  } catch (err) {
    Logger.log('api_saveBenefitReport error: ' + err.stack);
    writeAuditLogFailed_('CREATE', 'benefit', '', err.message);
    return errResult('บันทึกรายงานบริการไม่สำเร็จ: ' + err.message);
  }
}

/**
 * api_getBenefitReportsByPatient(token, patientId, fiscalYear?)
 */
function api_getBenefitReportsByPatient(token, patientId, fiscalYear) {
  _CURRENT_TOKEN_ = token;
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'benefit', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูรายงาน');

    if (!patientId) return errResult('กรุณาระบุ PatientID');

    const reports = findAllData(SHEET_NAMES.BENEFIT_REPORT, r =>
      r.PatientID === patientId &&
      (!fiscalYear || String(r.FiscalYear) === String(fiscalYear))
    );
    if (!reports.success) return reports;

    const data = (reports.data || []).map(r => {
      try { r.ServiceItems = JSON.parse(r.ServiceItems || '[]'); } catch(e){ r.ServiceItems = []; }
      delete r.__rowIndex;
      return r;
    }).sort((a, b) => String(b.ReportPeriod||'').localeCompare(String(a.ReportPeriod||'')));

    return okResult(data, 'พบ ' + data.length + ' รายงาน');
  } catch (err) {
    return errResult(err.message);
  }
}
