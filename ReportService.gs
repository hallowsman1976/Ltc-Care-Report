/**
 * ============================================================
 * ReportService.gs - Analytics & Reports
 * ============================================================
 * - getAnalytics: สถิติภาพรวมเพื่อรายงาน
 * - getIndividualReport: รายงานรายบุคคล
 * - getMonthlyReport: รายงานรายเดือน
 * - exportReport: เตรียมข้อมูลสำหรับ export (CSV/Excel) ฝั่ง client
 * Audit Log ทุกการ EXPORT
 * ============================================================
 */

/**
 * _accessiblePatients_(user, filters) — patient ที่ user เห็น + ผ่าน filter
 * @private
 */
function _accessiblePatients_(user, filters) {
  const f = filters || {};
  const r = findAllData(SHEET_NAMES.PATIENTS, x => {
    const s = String(x.Status||'').toLowerCase();
    return s !== 'deleted';
  });
  let list = r.success ? _filterByRole_(r.data || [], user) : [];
  if (f.village)       list = list.filter(p => p.VillageName === f.village || String(p.VillageNo) === String(f.village));
  if (f.caregiverId)   list = list.filter(p => p.CaregiverID === f.caregiverId);
  if (f.careManagerId) list = list.filter(p => p.CareManagerID === f.careManagerId);
  if (f.status)        list = list.filter(p => p.Status === f.status);
  return list;
}

/**
 * getAnalytics(filters) — สถิติภาพรวมสำหรับรายงาน
 */
function getAnalytics(filters) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'report', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูรายงาน');

    const patients = _accessiblePatients_(user, filters);
    const ids = new Set(patients.map(p => p.PatientID));
    const userMap = _getUserMap_();

    const visits = (findAllData(SHEET_NAMES.VISITS, r => ids.has(r.PatientID)).data) || [];
    const benefits = (findAllData(SHEET_NAMES.BENEFIT_REPORT, r => ids.has(r.PatientID)).data) || [];

    // ── byVillage ──
    const byVillage = {};
    patients.forEach(p => {
      const v = p.VillageName || ('ม.'+(p.VillageNo||'?'));
      byVillage[v] = (byVillage[v]||0) + 1;
    });

    // ── byTAI ──
    const byTai = { 'กลุ่ม 1':0,'กลุ่ม 2':0,'กลุ่ม 3':0,'กลุ่ม 4':0,'ไม่ระบุ':0 };
    patients.forEach(p => {
      const t = String(p.TAIGroup||'');
      let k = 'ไม่ระบุ';
      ['1','2','3','4'].forEach(n => { if (t.includes('กลุ่ม '+n)) k = 'กลุ่ม '+n; });
      byTai[k]++;
    });

    // ── byCaregiver ──
    const byCg = {};
    patients.forEach(p => {
      const name = (userMap[p.CaregiverID] || {}).fullName || 'ไม่ระบุผู้ดูแล';
      byCg[name] = (byCg[name]||0) + 1;
    });

    // ── monthly visits 12m ──
    const monthly = {};
    for (let i=11;i>=0;i--){ const d=new Date(); d.setMonth(d.getMonth()-i);
      monthly[d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')]=0; }
    visits.forEach(v => { const m=String(v.VisitDate||'').substring(0,7); if(m in monthly) monthly[m]++; });

    // ── counts ──
    const dependent = patients.filter(p => { const s=parseInt(p.ADLScore); return !isNaN(s)&&s<=11; }).length;
    const palliative = patients.filter(p => { const s=parseInt(p.PPSScore); return !isNaN(s)&&s<=30; }).length;
    const highRisk = patients.filter(p => { const s=String(p.MentalHealthStatus||'').toLowerCase();
      return s.includes('รุนแรง')||s.includes('ปานกลาง'); }).length;

    return okResult({
      totalCases: patients.length,
      dependent, palliative, highRisk,
      totalVisits: visits.length,
      totalBenefitReports: benefits.length,
      byVillage: Object.entries(byVillage).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count),
      byTaiGroup: Object.entries(byTai).map(([group,count])=>({group,count})),
      byCaregiver: Object.entries(byCg).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count),
      monthlyVisits: Object.entries(monthly).map(([month,count])=>({month,count}))
    }, 'สถิติรายงาน');
  } catch (err) {
    Logger.log('getAnalytics error: ' + err.stack);
    return errResult(err.message);
  }
}

/**
 * getIndividualReport(patientId) — รายงานรายบุคคล (ครบทุกมิติ)
 */
function getIndividualReport(patientId) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'report', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูรายงาน');
    if (!patientId) return errResult('กรุณาระบุ PatientID');

    const p = findData(SHEET_NAMES.PATIENTS, 'PatientID', patientId);
    if (!p.success || !p.data) return errResult('ไม่พบผู้ป่วย');
    // ตรวจสิทธิ์
    const patient = p.data;
    if (user.role === 'cm' && patient.CareManagerID !== user.userId) return errResult('ไม่มีสิทธิ์');
    if (user.role === 'cg' && patient.CaregiverID !== user.userId) return errResult('ไม่มีสิทธิ์');

    const latest = (sheet, dateKey) => {
      const r = findAllData(sheet, x => x.PatientID === patientId);
      if (!r.success || !r.data.length) return null;
      return r.data.sort((a,b)=>String(b[dateKey]||'').localeCompare(String(a[dateKey]||'')))[0];
    };
    const sanitize = (o) => { if(!o) return null; const c={...o}; delete c.__rowIndex; return c; };

    const visits = (findAllData(SHEET_NAMES.VISITS, x=>x.PatientID===patientId).data || [])
      .sort((a,b)=>(parseInt(b.VisitNo)||0)-(parseInt(a.VisitNo)||0)).map(sanitize);
    const carePlans = (findAllData(SHEET_NAMES.CARE_PLANS, x=>x.PatientID===patientId).data || []).map(sanitize);
    const benefits = (findAllData(SHEET_NAMES.BENEFIT_REPORT, x=>x.PatientID===patientId).data || []).map(b=>{
      try{b.ServiceItems=JSON.parse(b.ServiceItems||'[]');}catch(e){b.ServiceItems=[];} delete b.__rowIndex; return b; });

    const out = { ...patient };
    delete out.__rowIndex;
    if (out.CID) out.CID = maskCID(out.CID);
    out.Age = _calculateAge_(out.BirthDate);

    return okResult({
      patient: out,
      latestVital: sanitize(latest(SHEET_NAMES.VITAL_SIGNS, 'VisitDate')),
      latestADL:   sanitize(latest(SHEET_NAMES.ADL, 'AssessmentDate')),
      latestPPS:   sanitize(latest(SHEET_NAMES.PPSA, 'AssessmentDate')),
      latestMental:sanitize(latest(SHEET_NAMES.MENTAL_HEALTH, 'AssessmentDate')),
      visits, carePlans, benefits,
      visitCount: visits.length
    }, 'รายงานรายบุคคล');
  } catch (err) {
    Logger.log('getIndividualReport error: ' + err.stack);
    return errResult(err.message);
  }
}

/**
 * getMonthlyReport(filters) — รายงานรายเดือน {fiscalYear, month}
 */
function getMonthlyReport(filters) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'report', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูรายงาน');

    const f = filters || {};
    const month = f.month ? String(f.month).padStart(2,'0') : null;
    const year = f.year || new Date().getFullYear();
    const ym = month ? (year + '-' + month) : null;

    const patients = _accessiblePatients_(user, filters);
    const pmap = {}; patients.forEach(p => pmap[p.PatientID] = p);
    const userMap = _getUserMap_();

    const visits = (findAllData(SHEET_NAMES.VISITS, r => pmap[r.PatientID]).data || [])
      .filter(v => !ym || String(v.VisitDate||'').startsWith(ym));

    // ── สรุปต่อ patient ──
    const perPatient = {};
    visits.forEach(v => {
      if (!perPatient[v.PatientID]) {
        const p = pmap[v.PatientID];
        perPatient[v.PatientID] = {
          patientId: v.PatientID, fullName: p.FullName,
          village: p.VillageName || ('ม.'+(p.VillageNo||'-')),
          caregiver: (userMap[p.CaregiverID]||{}).fullName || '-',
          visitCount: 0, lastVisit: ''
        };
      }
      perPatient[v.PatientID].visitCount++;
      const d = String(v.VisitDate||'').split('T')[0];
      if (d > perPatient[v.PatientID].lastVisit) perPatient[v.PatientID].lastVisit = d;
    });

    // ── benefit เดือนนี้ ──
    const benefits = (findAllData(SHEET_NAMES.BENEFIT_REPORT, r => pmap[r.PatientID]).data || [])
      .filter(b => !month || (String(b.ReportMonth) === String(parseInt(month)) && String(b.FiscalYear) === String(year)));

    return okResult({
      period: ym || ('ปี ' + year),
      year, month: month ? parseInt(month) : null,
      totalVisits: visits.length,
      patientsSummary: Object.values(perPatient).sort((a,b)=>b.visitCount-a.visitCount),
      benefitCount: benefits.length,
      totalServices: benefits.reduce((s,b)=>s+(parseInt(b.TotalServicesProvided)||0),0)
    }, 'รายงานรายเดือน');
  } catch (err) {
    Logger.log('getMonthlyReport error: ' + err.stack);
    return errResult(err.message);
  }
}

/**
 * exportReport(reportType, filters) — เตรียมข้อมูลตารางสำหรับ export
 * reportType: individual | village | caregiver | monthly | benefit | overdue | highrisk
 * คืน { columns:[], rows:[{}], filename }
 */
function exportReport(reportType, filters) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'report', 'export');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ส่งออกรายงาน');

    const f = filters || {};
    const patients = _accessiblePatients_(user, filters);
    const pmap = {}; patients.forEach(p => pmap[p.PatientID]=p);
    const userMap = _getUserMap_();
    const today = formatDateISO(new Date());

    let columns = [], rows = [], filename = 'report';

    if (reportType === 'individual' || reportType === 'patient') {
      columns = ['ชื่อ-นามสกุล','HN','CID','อายุ','เพศ','หมู่บ้าน','TAI','ADL','PPS','สุขภาพจิต','สิทธิ์','CM','CG','สถานะ'];
      rows = patients.map(p => ({
        'ชื่อ-นามสกุล': p.FullName, 'HN': p.HN||'', 'CID': maskCID(p.CID),
        'อายุ': _calculateAge_(p.BirthDate), 'เพศ': p.Sex||'',
        'หมู่บ้าน': p.VillageName||('ม.'+(p.VillageNo||'')),
        'TAI': p.TAIGroup||'', 'ADL': p.ADLScore||'', 'PPS': p.PPSScore||'',
        'สุขภาพจิต': p.MentalHealthStatus||'', 'สิทธิ์': p.RightType||'',
        'CM': (userMap[p.CareManagerID]||{}).fullName||'', 'CG': (userMap[p.CaregiverID]||{}).fullName||'',
        'สถานะ': p.Status||''
      }));
      filename = 'patient_report';

    } else if (reportType === 'village') {
      const agg = {};
      patients.forEach(p => {
        const v = p.VillageName||('ม.'+(p.VillageNo||'?'));
        const a = agg[v] = agg[v] || { village:v, total:0, dependent:0, palliative:0 };
        a.total++;
        if (parseInt(p.ADLScore)<=11) a.dependent++;
        if (parseInt(p.PPSScore)<=30) a.palliative++;
      });
      columns = ['หมู่บ้าน','จำนวนเคส','พึ่งพิง (ADL≤11)','Palliative'];
      rows = Object.values(agg).map(a => ({
        'หมู่บ้าน': a.village, 'จำนวนเคส': a.total,
        'พึ่งพิง (ADL≤11)': a.dependent, 'Palliative': a.palliative
      }));
      filename = 'village_report';

    } else if (reportType === 'caregiver') {
      const agg = {};
      patients.forEach(p => {
        const name = (userMap[p.CaregiverID]||{}).fullName || 'ไม่ระบุ';
        const a = agg[name] = agg[name] || { cg:name, total:0, dependent:0 };
        a.total++;
        if (parseInt(p.ADLScore)<=11) a.dependent++;
      });
      columns = ['ผู้ดูแล (CG)','จำนวนเคส','พึ่งพิง'];
      rows = Object.values(agg).map(a => ({ 'ผู้ดูแล (CG)': a.cg, 'จำนวนเคส': a.total, 'พึ่งพิง': a.dependent }));
      filename = 'caregiver_report';

    } else if (reportType === 'monthly') {
      const mr = getMonthlyReport(filters);
      if (!mr.success) return mr;
      columns = ['ชื่อ-นามสกุล','หมู่บ้าน','ผู้ดูแล','จำนวนครั้งเยี่ยม','เยี่ยมล่าสุด'];
      rows = mr.data.patientsSummary.map(s => ({
        'ชื่อ-นามสกุล': s.fullName, 'หมู่บ้าน': s.village, 'ผู้ดูแล': s.caregiver,
        'จำนวนครั้งเยี่ยม': s.visitCount, 'เยี่ยมล่าสุด': formatDateThai(s.lastVisit)
      }));
      filename = 'monthly_report_' + (mr.data.period||'');

    } else if (reportType === 'benefit') {
      const ids = new Set(patients.map(p=>p.PatientID));
      const benefits = (findAllData(SHEET_NAMES.BENEFIT_REPORT, r => ids.has(r.PatientID)).data || [])
        .filter(b => !f.year || String(b.FiscalYear)===String(f.year))
        .filter(b => !f.month || String(b.ReportMonth)===String(parseInt(f.month)));
      columns = ['ชื่อ-นามสกุล','งวด','จำนวนบริการ','รายการบริการ','สถานะ'];
      rows = benefits.map(b => {
        const p = pmap[b.PatientID] || {};
        let items = []; try { items = JSON.parse(b.ServiceItems||'[]'); } catch(e){}
        return {
          'ชื่อ-นามสกุล': p.FullName||b.PatientID, 'งวด': b.ReportPeriod||'',
          'จำนวนบริการ': b.TotalServicesProvided||0,
          'รายการบริการ': items.map(i=>i.name).join(' / '),
          'สถานะ': b.ReportStatus||''
        };
      });
      filename = 'benefit_report';

    } else if (reportType === 'overdue') {
      const visits = (findAllData(SHEET_NAMES.VISITS, r => pmap[r.PatientID]).data || []);
      const latest = {};
      visits.forEach(v => { const c=latest[v.PatientID];
        if(!c||(parseInt(v.VisitNo)||0)>(parseInt(c.VisitNo)||0)) latest[v.PatientID]=v; });
      columns = ['ชื่อ-นามสกุล','หมู่บ้าน','ผู้ดูแล','เยี่ยมล่าสุด','นัดถัดไป','เลยกำหนด(วัน)'];
      rows = [];
      patients.forEach(p => {
        const lv = latest[p.PatientID];
        const next = lv ? String(lv.NextVisitDate||'').split('T')[0] : '';
        if (next && next < today) {
          rows.push({
            'ชื่อ-นามสกุล': p.FullName, 'หมู่บ้าน': p.VillageName||('ม.'+(p.VillageNo||'')),
            'ผู้ดูแล': (userMap[p.CaregiverID]||{}).fullName||'',
            'เยี่ยมล่าสุด': formatDateThai(lv.VisitDate),
            'นัดถัดไป': formatDateThai(next),
            'เลยกำหนด(วัน)': Math.floor((new Date(today)-new Date(next))/86400000)
          });
        }
      });
      filename = 'overdue_report';

    } else if (reportType === 'highrisk') {
      const ids = new Set(patients.map(p=>p.PatientID));
      const mh = (findAllData(SHEET_NAMES.MENTAL_HEALTH, r => ids.has(r.PatientID) &&
        String(r.RiskLevel||'').toLowerCase()==='high').data || []);
      columns = ['ชื่อ-นามสกุล','วันที่ประเมิน','แบบประเมิน','คะแนน','ผล','คำแนะนำ'];
      rows = mh.map(m => {
        const p = pmap[m.PatientID]||{};
        return {
          'ชื่อ-นามสกุล': p.FullName||m.PatientID, 'วันที่ประเมิน': formatDateThai(m.AssessmentDate),
          'แบบประเมิน': m.ScreeningType, 'คะแนน': m.TotalScore,
          'ผล': m.Result, 'คำแนะนำ': m.Recommendation
        };
      });
      filename = 'highrisk_report';

    } else {
      return errResult('ไม่รู้จักประเภทรายงาน: ' + reportType);
    }

    // ── Audit ──
    writeAuditLog('EXPORT', 'report', reportType, null, { rows: rows.length, filters: f });

    return okResult({ columns, rows, filename, reportType, count: rows.length },
      'เตรียมข้อมูล export ' + rows.length + ' แถว');
  } catch (err) {
    Logger.log('exportReport error: ' + err.stack);
    writeAuditLogFailed_('EXPORT', 'report', reportType, err.message);
    return errResult(err.message);
  }
}

// ============================================================
// ── API WRAPPERS ────────────────────────────────────────────
// ============================================================

function api_getAnalytics(token, filters) {
  _CURRENT_TOKEN_ = token;
  try { return getAnalytics(filters); } catch (e) { return errResult(e.message); }
}
function api_getIndividualReport(token, patientId) {
  _CURRENT_TOKEN_ = token;
  try { return getIndividualReport(patientId); } catch (e) { return errResult(e.message); }
}
function api_getMonthlyReport(token, filters) {
  _CURRENT_TOKEN_ = token;
  try { return getMonthlyReport(filters); } catch (e) { return errResult(e.message); }
}
function api_exportReport(token, reportType, filters) {
  _CURRENT_TOKEN_ = token;
  try { return exportReport(reportType, filters); } catch (e) { return errResult(e.message); }
}
