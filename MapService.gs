/**
 * ============================================================
 * MapService.gs - Geographic Case Map
 * ============================================================
 * ดึงข้อมูลผู้ป่วยพร้อมพิกัด GPS + สถานะสีสำหรับแสดงบนแผนที่
 * สีตามสถานะ:
 *   🟢 green  = ดูแลตามแผน (on plan)
 *   🟡 yellow = ใกล้ครบกำหนดเยี่ยม (≤ 7 วัน)
 *   🔴 red    = เลยกำหนด / ต้องติดตาม
 *   🟣 purple = Palliative Care (PPS ≤ 30)
 * กรองตาม role อัตโนมัติ
 * ============================================================
 */

const MAP_STATUS_COLORS = {
  onplan:    { color:'#16a34a', label:'ดูแลตามแผน',         key:'green' },
  nearing:   { color:'#ca8a04', label:'ใกล้ครบกำหนดเยี่ยม',  key:'yellow' },
  overdue:   { color:'#dc2626', label:'เลยกำหนด/ต้องติดตาม', key:'red' },
  palliative:{ color:'#9333ea', label:'Palliative Care',     key:'purple' }
};

/**
 * _computeCaseStatus_(patient, latestVisit, todayISO) — คำนวณสถานะของเคส
 * @private
 */
function _computeCaseStatus_(patient, latestVisit, todayISO) {
  // 1) Palliative (PPS <= 30) มีลำดับความสำคัญสูงสุด
  const pps = parseInt(patient.PPSScore);
  if (!isNaN(pps) && pps <= 30 && pps >= 0 && String(patient.PPSScore) !== '') {
    return 'palliative';
  }
  // 2) มีนัดครั้งต่อไป
  if (latestVisit && latestVisit.NextVisitDate) {
    const next = String(latestVisit.NextVisitDate).split('T')[0];
    if (next) {
      if (next < todayISO) return 'overdue';
      const in7 = formatDateISO(new Date(new Date(todayISO).getTime() + 7*86400000));
      if (next <= in7) return 'nearing';
      return 'onplan';
    }
  }
  // 3) ไม่เคยเยี่ยม และลงทะเบียนนานเกิน 30 วัน → overdue
  if (!latestVisit && patient.RegisterDate) {
    const reg = String(patient.RegisterDate).split('T')[0];
    const days = Math.floor((new Date(todayISO) - new Date(reg)) / 86400000);
    if (days > 30) return 'overdue';
  }
  return 'onplan';
}

/**
 * getMapCases(filters) — ดึงรายการเคสพร้อมพิกัดและสถานะ
 * @param {Object} [filters] - {village, caregiverId, status}  (status = green/yellow/red/purple)
 * @returns {Object} {success, data: {cases, center, counts, legend}, message}
 */
function getMapCases(filters) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'patient', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูข้อมูลแผนที่');

    const f = filters || {};

    // ── ดึงผู้ป่วย + กรอง role ──
    const pResult = findAllData(SHEET_NAMES.PATIENTS, r => {
      const s = String(r.Status||'').toLowerCase();
      return s !== 'deleted' && s !== 'inactive';
    });
    if (!pResult.success) return pResult;
    let patients = _filterByRole_(pResult.data || [], user);

    // ── filter เพิ่มเติม ──
    if (f.village) {
      patients = patients.filter(p => p.VillageName === f.village || String(p.VillageNo) === String(f.village));
    }
    if (f.caregiverId) {
      patients = patients.filter(p => p.CaregiverID === f.caregiverId);
    }

    const patientIds = new Set(patients.map(p => p.PatientID));
    const userMap = _getUserMap_();

    // ── หา visit ล่าสุดต่อ patient ──
    const vResult = findAllData(SHEET_NAMES.VISITS, r => patientIds.has(r.PatientID));
    const latestVisit = {};
    (vResult.data || []).forEach(v => {
      const c = latestVisit[v.PatientID];
      if (!c || (parseInt(v.VisitNo)||0) > (parseInt(c.VisitNo)||0)) latestVisit[v.PatientID] = v;
    });

    const today = formatDateISO(new Date());
    const counts = { green:0, yellow:0, red:0, purple:0, noGps:0 };
    const cases = [];
    let sumLat = 0, sumLng = 0, gpsCount = 0;

    patients.forEach(p => {
      const lat = parseFloat(p.Latitude), lng = parseFloat(p.Longitude);
      const hasGps = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;

      const statusKey = _computeCaseStatus_(p, latestVisit[p.PatientID], today);
      const status = MAP_STATUS_COLORS[statusKey];

      // ── filter ตามสี ──
      if (f.status && status.key !== f.status) return;

      counts[status.key]++;
      if (!hasGps) { counts.noGps++; return; }

      sumLat += lat; sumLng += lng; gpsCount++;

      const cg = userMap[p.CaregiverID] || {};
      const lv = latestVisit[p.PatientID];

      cases.push({
        patientId: p.PatientID,
        fullName: p.FullName,
        age: _calculateAge_(p.BirthDate),
        sex: p.Sex || '',
        lat, lng,
        adlScore: p.ADLScore || '',
        taiGroup: p.TAIGroup || '',
        ppsScore: p.PPSScore || '',
        phone: p.Phone || '',
        caregiverName: cg.fullName || '',
        caregiverPhone: cg.phone || p.MainCaregiverPhone || '',
        mainCaregiverPhone: p.MainCaregiverPhone || '',
        village: p.VillageName || ('ม.' + (p.VillageNo||'-')),
        lastVisitDate: lv ? String(lv.VisitDate||'').split('T')[0] : null,
        nextVisitDate: lv ? String(lv.NextVisitDate||'').split('T')[0] : null,
        statusKey: status.key,
        statusColor: status.color,
        statusLabel: status.label
      });
    });

    // ── center: เฉลี่ยพิกัด หรือ default จาก settings ──
    let center;
    if (gpsCount > 0) {
      center = { lat: sumLat/gpsCount, lng: sumLng/gpsCount };
    } else {
      center = {
        lat: parseFloat(getSettingValue_('MAP_DEFAULT_LAT', '13.736717')),
        lng: parseFloat(getSettingValue_('MAP_DEFAULT_LNG', '100.523186'))
      };
    }

    // ── filter options ──
    const villages = [...new Set(patients
      .map(p => p.VillageName || (p.VillageNo ? 'ม.'+p.VillageNo : ''))
      .filter(v => v))].sort();
    const caregivers = Object.entries(userMap)
      .filter(([id, u]) => u.role === 'cg')
      .map(([id, u]) => ({ userId: id, fullName: u.fullName }));

    return okResult({
      cases, center, counts,
      legend: Object.values(MAP_STATUS_COLORS),
      filterOptions: { villages, caregivers }
    }, 'พบ ' + cases.length + ' เคสที่มีพิกัด');
  } catch (err) {
    Logger.log('getMapCases error: ' + err.stack);
    return errResult('ดึงข้อมูลแผนที่ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * api_getMapCases(token, filters)
 */
function api_getMapCases(token, filters) {
  _CURRENT_TOKEN_ = token;
  try { return getMapCases(filters); }
  catch (err) { return errResult(err.message); }
}
