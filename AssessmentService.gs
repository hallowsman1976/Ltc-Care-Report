/**
 * ============================================================
 * AssessmentService.gs - LTC Health Assessment Forms
 * ============================================================
 * จัดการแบบประเมินสุขภาพทั้งหมดสำหรับ LTC:
 *   1. Vital Signs (สัญญาณชีพ) - BMI, BP, DTX
 *   2. ADL (Activities of Daily Living) - Thai 0-20 scale + TAI
 *   3. PPS (Palliative Performance Scale)
 *   4. Mental Health Screening - 2Q / 9Q
 *
 * ⚠️ DISCLAIMER:
 *   ผลการแปลความหมายทั้งหมดเป็นเพียงการคัดกรองเบื้องต้น (Preliminary Screening)
 *   ไม่ใช่การวินิจฉัยทางการแพทย์ (NOT a clinical diagnosis)
 *   ต้องให้แพทย์ยืนยันผลก่อนวางแผนการรักษา
 *
 * Requirements:
 * - ADL คะแนนรวมอัตโนมัติ
 * - ADL ≤ 11 = พึ่งพิง (Dependent)
 * - 2Q เสี่ยง → flag ให้แสดง 9Q
 * - 9Q ตรวจพบความคิดทำร้ายตนเอง → RiskLevel = high + warning
 * - Audit Log ทุกครั้ง
 * ============================================================
 */

// ── Disclaimer ที่จะส่งกลับไปกับทุก response ──
const ASSESSMENT_DISCLAIMER =
  '⚠️ ผลการแปลความหมายนี้เป็นเพียงการคัดกรองเบื้องต้น ไม่ใช่การวินิจฉัยทางการแพทย์ ' +
  'กรุณาปรึกษาแพทย์เพื่อยืนยันผลและวางแผนการรักษา';

// ────────────────────────────────────────────────────────────
// ── COMMON HELPERS ──────────────────────────────────────────
// ────────────────────────────────────────────────────────────

/**
 * _verifyVisit_(visitId, user) — ตรวจสอบว่า visit มีจริง + user เข้าถึงได้
 * คืน {visit, patient}
 * @private
 */
function _verifyVisit_(visitId, user) {
  if (!visitId) throw new Error('ต้องระบุ VisitID');
  const v = findData(SHEET_NAMES.VISITS, 'VisitID', visitId);
  if (!v.success || !v.data) throw new Error('ไม่พบ Visit: ' + visitId);

  const p = findData(SHEET_NAMES.PATIENTS, 'PatientID', v.data.PatientID);
  if (!p.success || !p.data) throw new Error('ไม่พบผู้ป่วยของ Visit นี้');

  // ── ตรวจสิทธิ์ตาม role ──
  if (user.role === 'admin' || user.role === 'viewer') {
    return { visit: v.data, patient: p.data };
  }
  if (user.role === 'cm' && p.data.CareManagerID === user.userId) {
    return { visit: v.data, patient: p.data };
  }
  if (user.role === 'cg' && p.data.CaregiverID === user.userId) {
    return { visit: v.data, patient: p.data };
  }
  throw new Error('ไม่มีสิทธิ์เข้าถึง Visit ของผู้ป่วยรายนี้');
}

/**
 * _checkPatientAccessForRead_(patientId, user) — เช็คสิทธิ์อ่านข้อมูลผู้ป่วย
 * @private
 */
function _checkPatientAccessForRead_(patientId, user) {
  if (!patientId) throw new Error('ต้องระบุ PatientID');
  const p = findData(SHEET_NAMES.PATIENTS, 'PatientID', patientId);
  if (!p.success || !p.data) throw new Error('ไม่พบผู้ป่วย');
  if (user.role === 'admin' || user.role === 'viewer') return p.data;
  if (user.role === 'cm' && p.data.CareManagerID === user.userId) return p.data;
  if (user.role === 'cg' && p.data.CaregiverID === user.userId) return p.data;
  throw new Error('ไม่มีสิทธิ์เข้าถึงข้อมูลผู้ป่วยรายนี้');
}

/**
 * _updatePatientSummary_(patientId, fields) — อัปเดต summary fields ใน Patients
 * เช่น ADLScore, TAIGroup, PPSScore, MentalHealthStatus, DependencyStatus
 * @private
 */
function _updatePatientSummary_(patientId, fields) {
  try {
    updateData(SHEET_NAMES.PATIENTS, 'PatientID', patientId, fields);
  } catch (e) {
    Logger.log('_updatePatientSummary_ warning: ' + e.message);
  }
}

/**
 * _sanitizeAssessment_(record) — ลบ __rowIndex, แปลง Date → ISO
 * @private
 */
function _sanitizeAssessment_(record) {
  if (!record) return null;
  const out = {};
  Object.entries(record).forEach(([k, v]) => {
    if (k === '__rowIndex') return;
    if (v instanceof Date) { out[k] = v.toISOString(); return; }
    out[k] = v;
  });
  return out;
}

// ============================================================
// ════════════════════════════════════════════════════════════
// ── 1. VITAL SIGNS ══════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// ============================================================

/**
 * calculateBMI(weight, height) — คำนวณ BMI จากน้ำหนัก(กก.) และส่วนสูง(ซม.)
 * @param {number} weight - กิโลกรัม
 * @param {number} height - เซนติเมตร
 * @returns {Object} {success, data: {bmi}, message}
 */
function calculateBMI(weight, height) {
  try {
    const w = parseFloat(weight);
    const h = parseFloat(height);
    if (!w || !h || w <= 0 || h <= 0) {
      return errResult('น้ำหนักและส่วนสูงต้องเป็นตัวเลขมากกว่า 0');
    }
    const heightM = h / 100;
    const bmi = Math.round((w / (heightM * heightM)) * 10) / 10;
    return okResult({ bmi }, 'คำนวณ BMI สำเร็จ');
  } catch (err) {
    return errResult('คำนวณ BMI ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * interpretBMI(bmi) — แปลความหมาย BMI ตามเกณฑ์เอเชีย (WHO Asia-Pacific)
 * @param {number} bmi
 * @returns {Object} {success, data: {level, color, advice}, message, disclaimer}
 */
function interpretBMI(bmi) {
  try {
    const b = parseFloat(bmi);
    if (isNaN(b) || b <= 0) return errResult('BMI ไม่ถูกต้อง');

    let level, color, advice;
    if (b < 18.5)        { level = 'น้ำหนักน้อย (Underweight)';   color = 'blue';   advice = 'ควรเพิ่มสารอาหารและพบโภชนากร'; }
    else if (b < 23.0)   { level = 'ปกติ (Normal)';                 color = 'green';  advice = 'รักษาน้ำหนักให้สม่ำเสมอ'; }
    else if (b < 25.0)   { level = 'น้ำหนักเกิน (Overweight)';      color = 'yellow'; advice = 'ควบคุมอาหารและออกกำลังกาย'; }
    else if (b < 30.0)   { level = 'โรคอ้วนระดับ 1 (Obese I)';      color = 'orange'; advice = 'พบแพทย์เพื่อประเมินความเสี่ยง'; }
    else                  { level = 'โรคอ้วนระดับ 2 (Obese II)';     color = 'red';    advice = 'พบแพทย์โดยด่วน มีความเสี่ยงสูง'; }

    return {
      success: true,
      data: { bmi: b, level, color, advice },
      message: 'BMI ' + b + ' = ' + level,
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    return errResult('แปลความหมาย BMI ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * interpretBP(sbp, dbp) — แปลความหมายความดันโลหิต ตาม AHA 2017
 * @param {number} sbp - ความดันตัวบน (mmHg)
 * @param {number} dbp - ความดันตัวล่าง (mmHg)
 */
function interpretBP(sbp, dbp) {
  try {
    const s = parseInt(sbp), d = parseInt(dbp);
    if (!s || !d || s <= 0 || d <= 0) return errResult('ความดันโลหิตไม่ถูกต้อง');

    let level, color, urgent = false, advice;

    if (s > 180 || d > 120) {
      level = 'วิกฤต (Hypertensive Crisis)'; color = 'red'; urgent = true;
      advice = '⚠️ ต้องพบแพทย์ฉุกเฉินทันที';
    } else if (s >= 140 || d >= 90) {
      level = 'ความดันสูงระดับ 2 (Stage 2)'; color = 'red';
      advice = 'พบแพทย์ภายในสัปดาห์ ทบทวนยา';
    } else if (s >= 130 || d >= 80) {
      level = 'ความดันสูงระดับ 1 (Stage 1)'; color = 'orange';
      advice = 'ปรับพฤติกรรม + ติดตามใกล้ชิด';
    } else if (s >= 120 && d < 80) {
      level = 'ความดันค่อนข้างสูง (Elevated)'; color = 'yellow';
      advice = 'ปรับพฤติกรรม ลดเค็ม ออกกำลังกาย';
    } else if (s < 90 || d < 60) {
      level = 'ความดันต่ำ (Hypotension)'; color = 'blue';
      advice = 'ระวังการล้ม ดื่มน้ำให้เพียงพอ';
    } else {
      level = 'ปกติ (Normal)'; color = 'green';
      advice = 'รักษาพฤติกรรมที่ดีไว้';
    }

    return {
      success: true,
      data: { sbp: s, dbp: d, level, color, urgent, advice },
      message: 'BP ' + s + '/' + d + ' = ' + level,
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    return errResult('แปลความหมาย BP ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * interpretDTX(dtx) — แปลความหมายระดับน้ำตาลในเลือด (mg/dL)
 * เกณฑ์: เจาะปลายนิ้ว (capillary blood glucose)
 * @param {number} dtx
 */
function interpretDTX(dtx) {
  try {
    const v = parseInt(dtx);
    if (!v || v <= 0) return errResult('ค่า DTX ไม่ถูกต้อง');

    let level, color, urgent = false, advice;

    if (v < 70) {
      level = 'น้ำตาลต่ำ (Hypoglycemia)'; color = 'red'; urgent = true;
      advice = '⚠️ ให้รับประทานน้ำตาลทันที 15g แล้ววัดซ้ำใน 15 นาที';
    } else if (v < 100) {
      level = 'ปกติ (Normal)'; color = 'green';
      advice = 'อยู่ในเกณฑ์ปกติ';
    } else if (v < 126) {
      level = 'ก่อนเป็นเบาหวาน (Pre-diabetes)'; color = 'yellow';
      advice = 'ปรับอาหารและออกกำลังกาย ตรวจซ้ำใน 3-6 เดือน';
    } else if (v < 200) {
      level = 'เบาหวาน (Diabetes)'; color = 'orange';
      advice = 'พบแพทย์เพื่อยืนยันและรับยา';
    } else if (v < 400) {
      level = 'น้ำตาลสูง (Hyperglycemia)'; color = 'red';
      advice = 'พบแพทย์โดยด่วน ทบทวนยาเบาหวาน';
    } else {
      level = 'วิกฤต (Severe Hyperglycemia)'; color = 'red'; urgent = true;
      advice = '⚠️ ต้องพบแพทย์ฉุกเฉินทันที เสี่ยง DKA';
    }

    return {
      success: true,
      data: { dtx: v, level, color, urgent, advice },
      message: 'DTX ' + v + ' mg/dL = ' + level,
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    return errResult('แปลความหมาย DTX ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * saveVitalSigns(data) — บันทึกสัญญาณชีพ
 * @param {Object} data - {VisitID, Weight, Height, Temperature, Pulse, RespiratoryRate,
 *                         SBP, DBP, DTX, PainScore, OxygenSat, VisitDate?}
 */
function saveVitalSigns(data) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'screening', 'create');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์บันทึกสัญญาณชีพ');

    if (!data || typeof data !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');
    if (!data.VisitID) return errResult('ต้องระบุ VisitID');

    const { visit, patient } = _verifyVisit_(data.VisitID, user);

    // ── คำนวณ BMI + interpretations อัตโนมัติ ──
    let bmi = '', bmiInterp = '';
    if (data.Weight && data.Height) {
      const bmiResult = calculateBMI(data.Weight, data.Height);
      if (bmiResult.success) {
        bmi = bmiResult.data.bmi;
        const bmiInt = interpretBMI(bmi);
        if (bmiInt.success) bmiInterp = bmiInt.data.level;
      }
    }

    let bpInterp = '';
    if (data.SBP && data.DBP) {
      const bp = interpretBP(data.SBP, data.DBP);
      if (bp.success) bpInterp = bp.data.level;
    }

    let dtxInterp = '';
    if (data.DTX) {
      const dtx = interpretDTX(data.DTX);
      if (dtx.success) dtxInterp = dtx.data.level;
    }

    const vitalId = generateId('VS');
    const now = new Date().toISOString();

    const record = {
      VitalID:            vitalId,
      VisitID:            data.VisitID,
      PatientID:          visit.PatientID,
      VisitDate:          data.VisitDate || visit.VisitDate || formatDateISO(new Date()),
      Weight:             data.Weight || '',
      Height:             data.Height || '',
      BMI:                bmi,
      BMIInterpretation:  bmiInterp,
      Temperature:        data.Temperature || '',
      Pulse:              data.Pulse || '',
      RespiratoryRate:    data.RespiratoryRate || '',
      SBP:                data.SBP || '',
      DBP:                data.DBP || '',
      BPInterpretation:   bpInterp,
      DTX:                data.DTX || '',
      DTXInterpretation:  dtxInterp,
      PainScore:          data.PainScore || '',
      OxygenSat:          data.OxygenSat || '',
      CreatedAt:          now
    };

    const r = appendData(SHEET_NAMES.VITAL_SIGNS, record);
    if (!r.success) return r;

    // ── อัปเดต flag HasVitalSigns ใน Visit ──
    updateData(SHEET_NAMES.VISITS, 'VisitID', data.VisitID, { HasVitalSigns: true });

    writeAuditLog('CREATE', 'screening:vital', vitalId, null, {
      visitId: data.VisitID, patientId: visit.PatientID,
      bmi, bp: data.SBP + '/' + data.DBP, dtx: data.DTX
    });

    return {
      success: true,
      data: {
        vitalId, bmi,
        bmiInterpretation: bmiInterp,
        bpInterpretation: bpInterp,
        dtxInterpretation: dtxInterp
      },
      message: 'บันทึกสัญญาณชีพสำเร็จ',
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    Logger.log('saveVitalSigns error: ' + err.stack);
    writeAuditLogFailed_('CREATE', 'screening:vital', '', err.message);
    return errResult('บันทึกสัญญาณชีพไม่สำเร็จ: ' + err.message);
  }
}

/**
 * getVitalSignsByPatient(patientId) — ดึงประวัติสัญญาณชีพ
 * เรียง VisitDate ใหม่สุดก่อน
 */
function getVitalSignsByPatient(patientId) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'screening', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูข้อมูล');

    _checkPatientAccessForRead_(patientId, user);

    const result = findAllData(SHEET_NAMES.VITAL_SIGNS, r => r.PatientID === patientId);
    if (!result.success) return result;

    const sorted = (result.data || [])
      .sort((a, b) => String(b.VisitDate||'').localeCompare(String(a.VisitDate||'')))
      .map(_sanitizeAssessment_);

    return {
      success: true,
      data: sorted,
      message: 'พบ ' + sorted.length + ' รายการ',
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    Logger.log('getVitalSignsByPatient error: ' + err.stack);
    return errResult('ดึงข้อมูลไม่สำเร็จ: ' + err.message);
  }
}

// ============================================================
// ════════════════════════════════════════════════════════════
// ── 2. ADL (Activities of Daily Living) ════════════════════
// ════════════════════════════════════════════════════════════
// ============================================================
//
// Thai ADL Scale (LTC) — คะแนนรวม 0-20
// 10 รายการ:
//   1. Feeding (รับประทานอาหาร)        0-2
//   2. Grooming (ล้างหน้า แปรงฟัน)     0-1
//   3. Transfer (ลุก/ย้ายตัว)           0-3
//   4. ToiletUse (ใช้ห้องน้ำ)           0-2
//   5. Mobility (การเคลื่อนที่)         0-3
//   6. Dressing (สวมใส่เสื้อผ้า)        0-2
//   7. Stairs (ขึ้น-ลงบันได)            0-2
//   8. Bathing (อาบน้ำ)                  0-1
//   9. Bowels (กลั้นอุจจาระ)            0-2
//  10. Bladder (กลั้นปัสสาวะ)           0-2
//
// TAI Group (กลุ่มเป้าหมาย LTC ตามนิยาม สปสช.):
//   กลุ่ม 1 (ติดสังคม):       ADL 12-20  (Independent)
//   กลุ่ม 2 (ติดบ้าน):        ADL 5-11   (Partial Dependence) ← ≤11 = พึ่งพิง
//   กลุ่ม 3 (ติดเตียง สมองดี): ADL 0-4
//   กลุ่ม 4 (ติดเตียง สมองเสื่อม): ADL 0-4 + cognitive impairment
// ============================================================

const ADL_ITEMS = ['Feeding','Grooming','Transfer','ToiletUse','Mobility',
                    'Dressing','Stairs','Bathing','Bowels','Bladder'];

const ADL_MAX_PER_ITEM = {
  Feeding:2, Grooming:1, Transfer:3, ToiletUse:2, Mobility:3,
  Dressing:2, Stairs:2, Bathing:1, Bowels:2, Bladder:2
};

/**
 * calculateADL(data) — รวมคะแนน ADL จาก 10 รายการ
 * @param {Object} data - {Feeding, Grooming, ...}
 * @returns {Object} {success, data: {totalScore, itemScores}, message}
 */
function calculateADL(data) {
  try {
    if (!data || typeof data !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');

    let total = 0;
    const itemScores = {};
    for (let i = 0; i < ADL_ITEMS.length; i++) {
      const item = ADL_ITEMS[i];
      const max = ADL_MAX_PER_ITEM[item];
      const raw = data[item];
      const score = parseInt(raw);
      if (isNaN(score) || score < 0 || score > max) {
        return errResult('คะแนน ' + item + ' ต้องเป็น 0-' + max + ' (ได้รับ: ' + raw + ')');
      }
      itemScores[item] = score;
      total += score;
    }
    return okResult({ totalScore: total, itemScores }, 'รวมคะแนน ADL = ' + total);
  } catch (err) {
    return errResult('คำนวณ ADL ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * interpretADL(totalScore) — แปลความหมาย ADL Score (0-20)
 * @param {number} totalScore
 * @returns {Object} {success, data: {level, isDependent, color, advice}, message, disclaimer}
 */
function interpretADL(totalScore) {
  try {
    const s = parseInt(totalScore);
    if (isNaN(s) || s < 0 || s > 20) return errResult('คะแนน ADL ต้อง 0-20');

    let level, isDependent, color, advice;
    if (s >= 12) {
      level = 'ช่วยตนเองได้ (Independent)';
      isDependent = false;
      color = 'green';
      advice = 'ส่งเสริมกิจกรรมในชุมชน';
    } else if (s >= 5) {
      level = 'พึ่งพิงบางส่วน (Partial Dependence)';
      isDependent = true;
      color = 'yellow';
      advice = 'ต้องการการดูแลที่บ้าน + การฟื้นฟู';
    } else {
      level = 'พึ่งพิงเต็มที่ (Total Dependence)';
      isDependent = true;
      color = 'red';
      advice = 'ต้องการการดูแลใกล้ชิด + อุปกรณ์ช่วย';
    }

    return {
      success: true,
      data: { totalScore: s, level, isDependent, color, advice },
      message: 'ADL ' + s + '/20 = ' + level,
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    return errResult('แปลความหมาย ADL ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * classifyTAI(totalScore, hasCognitiveImpairment?) — จัดกลุ่ม TAI (กลุ่มเป้าหมาย LTC)
 * @param {number} totalScore - ADL 0-20
 * @param {boolean} [hasCognitiveImpairment] - มีภาวะสมองเสื่อมหรือไม่
 */
function classifyTAI(totalScore, hasCognitiveImpairment) {
  try {
    const s = parseInt(totalScore);
    if (isNaN(s) || s < 0 || s > 20) return errResult('คะแนน ADL ต้อง 0-20');

    let group, label, description;
    if (s >= 12) {
      group = 1; label = 'กลุ่ม 1 (ติดสังคม)';
      description = 'ผู้สูงอายุที่ช่วยเหลือตนเองได้ดี เน้นการส่งเสริมสุขภาพ';
    } else if (s >= 5) {
      group = 2; label = 'กลุ่ม 2 (ติดบ้าน)';
      description = 'ต้องการการดูแลที่บ้าน เน้นการเยี่ยมบ้าน + ฟื้นฟู';
    } else if (hasCognitiveImpairment) {
      group = 4; label = 'กลุ่ม 4 (ติดเตียง + สมองเสื่อม)';
      description = 'ต้องการการดูแลแบบประคับประคองและจัดการพฤติกรรม';
    } else {
      group = 3; label = 'กลุ่ม 3 (ติดเตียง สมองดี)';
      description = 'ต้องการการดูแลใกล้ชิด พลิกตัว ป้องกันแผลกดทับ';
    }

    return okResult({ group, label, description }, label);
  } catch (err) {
    return errResult('จัดกลุ่ม TAI ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * saveADLAssessment(data) — บันทึกแบบประเมิน ADL
 * @param {Object} data - {VisitID, PatientID?, Feeding, Grooming, ...}
 */
function saveADLAssessment(data) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'screening', 'create');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์บันทึก ADL');

    if (!data || typeof data !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');
    if (!data.VisitID) return errResult('ต้องระบุ VisitID');

    const { visit, patient } = _verifyVisit_(data.VisitID, user);

    // ── คำนวณคะแนนรวม ──
    const calcResult = calculateADL(data);
    if (!calcResult.success) return calcResult;
    const totalScore = calcResult.data.totalScore;

    // ── แปลความหมาย + กลุ่ม TAI ──
    const interp = interpretADL(totalScore);
    if (!interp.success) return interp;
    const tai = classifyTAI(totalScore, !!data.HasCognitiveImpairment);

    const adlId = generateId('ADL');
    const now = new Date().toISOString();

    const record = {
      ADLID:            adlId,
      PatientID:        visit.PatientID,
      VisitID:          data.VisitID,
      AssessmentDate:   data.AssessmentDate || visit.VisitDate || formatDateISO(new Date()),
      Feeding:          calcResult.data.itemScores.Feeding,
      Grooming:         calcResult.data.itemScores.Grooming,
      Transfer:         calcResult.data.itemScores.Transfer,
      ToiletUse:        calcResult.data.itemScores.ToiletUse,
      Mobility:         calcResult.data.itemScores.Mobility,
      Dressing:         calcResult.data.itemScores.Dressing,
      Stairs:           calcResult.data.itemScores.Stairs,
      Bathing:          calcResult.data.itemScores.Bathing,
      Bowels:           calcResult.data.itemScores.Bowels,
      Bladder:          calcResult.data.itemScores.Bladder,
      TotalADL:         totalScore,
      DependencyLevel:  interp.data.level,
      TAIGroup:         tai.success ? tai.data.label : '',
      AssessorID:       user.userId,
      CreatedAt:        now
    };

    const r = appendData(SHEET_NAMES.ADL, record);
    if (!r.success) return r;

    // ── อัปเดต Patient summary ──
    _updatePatientSummary_(visit.PatientID, {
      ADLScore: totalScore,
      TAIGroup: tai.success ? tai.data.label : '',
      DependencyStatus: interp.data.isDependent ? 'พึ่งพิง' : 'ช่วยตนเองได้'
    });

    // ── อัปเดต Visit flag ──
    updateData(SHEET_NAMES.VISITS, 'VisitID', data.VisitID, { HasADL: true });

    writeAuditLog('CREATE', 'screening:adl', adlId, null, {
      visitId: data.VisitID, patientId: visit.PatientID,
      totalScore, taiGroup: tai.data ? tai.data.label : '',
      isDependent: interp.data.isDependent
    });

    return {
      success: true,
      data: {
        adlId, totalScore,
        dependencyLevel: interp.data.level,
        isDependent: interp.data.isDependent,
        taiGroup: tai.data ? tai.data.label : '',
        advice: interp.data.advice
      },
      message: 'บันทึก ADL สำเร็จ คะแนน ' + totalScore + '/20 (' + interp.data.level + ')',
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    Logger.log('saveADLAssessment error: ' + err.stack);
    writeAuditLogFailed_('CREATE', 'screening:adl', '', err.message);
    return errResult('บันทึก ADL ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * getADLByPatient(patientId) — ดึงประวัติ ADL
 */
function getADLByPatient(patientId) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'screening', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูข้อมูล');

    _checkPatientAccessForRead_(patientId, user);

    const result = findAllData(SHEET_NAMES.ADL, r => r.PatientID === patientId);
    if (!result.success) return result;

    const sorted = (result.data || [])
      .sort((a, b) => String(b.AssessmentDate||'').localeCompare(String(a.AssessmentDate||'')))
      .map(_sanitizeAssessment_);

    return {
      success: true,
      data: sorted,
      message: 'พบ ' + sorted.length + ' รายการ',
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    Logger.log('getADLByPatient error: ' + err.stack);
    return errResult('ดึงข้อมูลไม่สำเร็จ: ' + err.message);
  }
}

// ============================================================
// ════════════════════════════════════════════════════════════
// ── 3. PPS (Palliative Performance Scale) ══════════════════
// ════════════════════════════════════════════════════════════
// ============================================================
// 5 มิติ × คะแนน 0-100 (step 10)
//   PPS 70-100: Active treatment
//   PPS 40-60:  Supportive care
//   PPS 0-30:   Palliative care (Palliative Flag = true)
// ============================================================

/**
 * calculatePPS(data) — คำนวณ PPS Score จาก 5 มิติ
 * ใช้กฎ "lowest applicable level" — เลือกระดับต่ำสุดที่เข้ากับมิติใดก็ตาม
 * รับค่าโดยตรงจาก data.PPSScore (ผู้ประเมินกำหนดเอง 0-100 step 10)
 * หรือคำนวณจาก 5 มิติถ้าระบุครบ
 * @param {Object} data - {PPSScore?, Ambulation, ActivityDisease, SelfCare, Intake, ConsciousLevel}
 */
function calculatePPS(data) {
  try {
    if (!data || typeof data !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');

    // ── ถ้าผู้ประเมินใส่ PPSScore โดยตรง ──
    if (data.PPSScore != null && data.PPSScore !== '') {
      const s = parseInt(data.PPSScore);
      if (isNaN(s) || s < 0 || s > 100 || s % 10 !== 0) {
        return errResult('PPSScore ต้องเป็นจำนวนเต็ม 0-100 ทีละ 10 (0,10,20,...,100)');
      }
      return okResult({ ppsScore: s, computedFrom: 'direct' }, 'PPS = ' + s);
    }

    // ── คำนวณจาก 5 มิติ — ต้องระบุครบ ──
    const dims = ['Ambulation','ActivityDisease','SelfCare','Intake','ConsciousLevel'];
    for (let i = 0; i < dims.length; i++) {
      if (data[dims[i]] == null || data[dims[i]] === '') {
        return errResult('กรุณาระบุ PPSScore หรือ ' + dims.join(', ') + ' ให้ครบ');
      }
    }

    const values = dims.map(d => parseInt(data[d]));
    if (values.some(v => isNaN(v) || v < 0 || v > 100 || v % 10 !== 0)) {
      return errResult('ทุกมิติต้องเป็นจำนวนเต็ม 0-100 ทีละ 10');
    }
    const ppsScore = Math.min.apply(null, values);
    return okResult({ ppsScore, computedFrom: 'min_of_dimensions' }, 'PPS = ' + ppsScore);
  } catch (err) {
    return errResult('คำนวณ PPS ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * interpretPPS(score) — แปลความหมาย PPS
 * @param {number} score
 * @returns {Object}
 */
function interpretPPS(score) {
  try {
    const s = parseInt(score);
    if (isNaN(s) || s < 0 || s > 100 || s % 10 !== 0) return errResult('PPS ต้อง 0-100 step 10');

    let category, level, palliativeFlag = false, color, advice;
    if (s >= 70) {
      category = 'active'; level = 'การดูแลแบบ Active'; color = 'green';
      advice = 'รักษาตามแผนปกติ';
    } else if (s >= 40) {
      category = 'supportive'; level = 'การดูแลแบบประคับประคอง'; color = 'yellow';
      advice = 'เพิ่มการดูแล ฟื้นฟู และโภชนาการ';
    } else {
      category = 'palliative'; level = 'Palliative Care'; color = 'red';
      palliativeFlag = true;
      advice = 'พิจารณา advance care planning + ดูแลครอบครัว';
    }

    let description = '';
    if (s >= 90)     description = 'ทำกิจกรรมปกติ ไม่มีโรค';
    else if (s >= 70) description = 'ทำกิจกรรมได้ มีโรคแต่ไม่จำกัด';
    else if (s >= 50) description = 'จำกัดกิจกรรม ต้องการความช่วยเหลือ';
    else if (s >= 30) description = 'นอนเป็นส่วนใหญ่ ช่วยเหลือตนเองได้น้อย';
    else if (s >= 10) description = 'นอนเตียงตลอดเวลา ดูแลทั้งหมด';
    else              description = 'เสียชีวิต';

    return {
      success: true,
      data: { ppsScore: s, category, level, description, palliativeFlag, color, advice },
      message: 'PPS ' + s + '% = ' + level,
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    return errResult('แปลความหมาย PPS ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * savePPSAssessment(data) — บันทึกแบบประเมิน PPS
 */
function savePPSAssessment(data) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'screening', 'create');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์บันทึก PPS');

    if (!data || typeof data !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');
    if (!data.VisitID) return errResult('ต้องระบุ VisitID');

    const { visit } = _verifyVisit_(data.VisitID, user);

    const calc = calculatePPS(data);
    if (!calc.success) return calc;
    const ppsScore = calc.data.ppsScore;

    const interp = interpretPPS(ppsScore);
    if (!interp.success) return interp;

    const ppsId = generateId('PPS');
    const now = new Date().toISOString();

    const record = {
      PPSID:           ppsId,
      PatientID:       visit.PatientID,
      VisitID:         data.VisitID,
      AssessmentDate:  data.AssessmentDate || visit.VisitDate || formatDateISO(new Date()),
      Ambulation:      data.Ambulation || '',
      ActivityDisease: data.ActivityDisease || '',
      SelfCare:        data.SelfCare || '',
      Intake:          data.Intake || '',
      ConsciousLevel:  data.ConsciousLevel || '',
      PPSScore:        ppsScore,
      Interpretation:  interp.data.level,
      PalliativeFlag:  interp.data.palliativeFlag,
      AssessorID:      user.userId,
      CreatedAt:       now
    };

    const r = appendData(SHEET_NAMES.PPSA, record);
    if (!r.success) return r;

    _updatePatientSummary_(visit.PatientID, { PPSScore: ppsScore });
    updateData(SHEET_NAMES.VISITS, 'VisitID', data.VisitID, { HasPPS: true });

    writeAuditLog('CREATE', 'screening:pps', ppsId, null, {
      visitId: data.VisitID, patientId: visit.PatientID,
      ppsScore, palliativeFlag: interp.data.palliativeFlag
    });

    return {
      success: true,
      data: {
        ppsId, ppsScore,
        interpretation: interp.data.level,
        category: interp.data.category,
        palliativeFlag: interp.data.palliativeFlag,
        advice: interp.data.advice
      },
      message: 'บันทึก PPS สำเร็จ ' + ppsScore + '% (' + interp.data.level + ')',
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    Logger.log('savePPSAssessment error: ' + err.stack);
    writeAuditLogFailed_('CREATE', 'screening:pps', '', err.message);
    return errResult('บันทึก PPS ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * getPPSByPatient(patientId) — ดึงประวัติ PPS
 */
function getPPSByPatient(patientId) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'screening', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูข้อมูล');

    _checkPatientAccessForRead_(patientId, user);

    const result = findAllData(SHEET_NAMES.PPSA, r => r.PatientID === patientId);
    if (!result.success) return result;

    const sorted = (result.data || [])
      .sort((a, b) => String(b.AssessmentDate||'').localeCompare(String(a.AssessmentDate||'')))
      .map(_sanitizeAssessment_);

    return {
      success: true,
      data: sorted,
      message: 'พบ ' + sorted.length + ' รายการ',
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    Logger.log('getPPSByPatient error: ' + err.stack);
    return errResult('ดึงข้อมูลไม่สำเร็จ: ' + err.message);
  }
}

// ============================================================
// ════════════════════════════════════════════════════════════
// ── 4. MENTAL HEALTH (2Q / 9Q) ═════════════════════════════
// ════════════════════════════════════════════════════════════
// ============================================================
//
// 2Q - คัดกรองภาวะซึมเศร้าเบื้องต้น (2 ข้อ):
//   Q1: ใน 2 สัปดาห์ที่ผ่านมา รู้สึก หดหู่ เศร้า ท้อแท้สิ้นหวัง หรือไม่?
//   Q2: ใน 2 สัปดาห์ที่ผ่านมา รู้สึก เบื่อ ทำอะไรก็ไม่เพลิดเพลิน หรือไม่?
//   ค่า: yes=1, no=0
//   ถ้าตอบ yes อย่างน้อย 1 ข้อ → "เสี่ยง" → ทำ 9Q ต่อ
//
// 9Q - แบบประเมินซึมเศร้า (PHQ-9 Thai, 9 ข้อ):
//   ค่าแต่ละข้อ: 0=ไม่มี, 1=มีบางวัน, 2=บ่อย, 3=ทุกวัน
//   Total 0-27
//   Q9 = ความคิดทำร้ายตนเอง → ถ้า > 0 → RiskLevel HIGH (เร่งด่วน)
//   ระดับ: 0-6 ไม่มี, 7-12 น้อย, 13-18 ปานกลาง, 19+ รุนแรง
// ============================================================

const QUESTIONS_2Q = [
  'ใน 2 สัปดาห์ที่ผ่านมา รวมวันนี้ ท่านรู้สึกหดหู่ เศร้า หรือท้อแท้สิ้นหวังหรือไม่?',
  'ใน 2 สัปดาห์ที่ผ่านมา รวมวันนี้ ท่านรู้สึกเบื่อ ทำอะไรก็ไม่เพลิดเพลินหรือไม่?'
];

const QUESTIONS_9Q = [
  'เบื่อ ไม่สนใจอยากทำอะไร',
  'ไม่สบายใจ ซึมเศร้า ท้อแท้',
  'หลับยาก/หลับๆ ตื่นๆ หรือหลับมากเกินไป',
  'เหนื่อยง่าย หรือไม่ค่อยมีแรง',
  'เบื่ออาหาร หรือกินมากเกินไป',
  'รู้สึกไม่ดีกับตัวเอง คิดว่าตัวเองล้มเหลว',
  'สมาธิไม่ดีเวลาทำสิ่งต่างๆ',
  'พูดช้า ทำอะไรช้าจนคนอื่นสังเกตได้ หรือกระสับกระส่ายมากกว่าปกติ',
  '⚠️ คิดทำร้ายตนเอง หรือคิดว่าตายไปจะดีกว่า'
];

/**
 * _yesNoToScore_(value) — แปลง yes/no/1/0/true/false → 0 or 1
 * @private
 */
function _yesNoToScore_(value) {
  if (value === 1 || value === '1' || value === true || value === 'true') return 1;
  const s = String(value || '').toLowerCase().trim();
  if (s === 'yes' || s === 'y' || s === 'ใช่') return 1;
  return 0;
}

/**
 * calculate2Q(data) — คำนวณคะแนน 2Q
 * @param {Object} data - {Q1, Q2}  (yes/no, 1/0, true/false)
 * @returns {Object} {success, data: {q1, q2, totalScore, atRisk, requireFollowUp9Q}, message}
 */
function calculate2Q(data) {
  try {
    if (!data) return errResult('ข้อมูลไม่ถูกต้อง');
    const q1 = _yesNoToScore_(data.Q1);
    const q2 = _yesNoToScore_(data.Q2);
    const total = q1 + q2;
    const atRisk = total >= 1;
    return okResult({
      q1, q2, totalScore: total, atRisk,
      requireFollowUp9Q: atRisk,
      questions: QUESTIONS_2Q
    }, '2Q = ' + total + '/2 ' + (atRisk ? '(เสี่ยง → ทำ 9Q ต่อ)' : '(ไม่เสี่ยง)'));
  } catch (err) {
    return errResult('คำนวณ 2Q ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * calculate9Q(data) — คำนวณคะแนน 9Q
 * @param {Object} data - {Q1..Q9} แต่ละข้อ 0-3
 * @returns {Object} {success, data: {scores, totalScore, suicidalThought, ...}, message}
 */
function calculate9Q(data) {
  try {
    if (!data) return errResult('ข้อมูลไม่ถูกต้อง');
    const scores = {};
    let total = 0;
    for (let i = 1; i <= 9; i++) {
      const v = parseInt(data['Q' + i]);
      if (isNaN(v) || v < 0 || v > 3) {
        return errResult('Q' + i + ' ต้องเป็น 0-3 (ได้รับ: ' + data['Q' + i] + ')');
      }
      scores['Q' + i] = v;
      total += v;
    }
    const suicidalThought = scores.Q9 > 0;
    return okResult({
      scores, totalScore: total,
      suicidalThought,
      suicidalScore: scores.Q9,
      questions: QUESTIONS_9Q
    }, '9Q = ' + total + '/27' + (suicidalThought ? ' ⚠️ พบความคิดทำร้ายตนเอง' : ''));
  } catch (err) {
    return errResult('คำนวณ 9Q ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * interpretMentalHealth(score, type) — แปลความหมาย mental health
 * @param {number} score
 * @param {string} type - '2Q' or '9Q'
 * @returns {Object}
 */
function interpretMentalHealth(score, type) {
  try {
    const s = parseInt(score);
    const t = String(type || '').toUpperCase();
    if (isNaN(s)) return errResult('คะแนนไม่ถูกต้อง');

    let result, riskLevel, recommendation;

    if (t === '2Q') {
      if (s >= 1) {
        result = 'มีความเสี่ยงต่อภาวะซึมเศร้า';
        riskLevel = 'medium';
        recommendation = 'ทำแบบประเมิน 9Q เพื่อยืนยันและจัดระดับความรุนแรง';
      } else {
        result = 'ไม่มีความเสี่ยง';
        riskLevel = 'low';
        recommendation = 'ติดตามตามนัด ส่งเสริมสุขภาพจิต';
      }
    } else if (t === '9Q') {
      if (s < 7) {
        result = 'ไม่มีอาการของภาวะซึมเศร้า';
        riskLevel = 'low';
        recommendation = 'ไม่จำเป็นต้องส่งต่อ ติดตามตามนัด';
      } else if (s <= 12) {
        result = 'มีอาการของโรคซึมเศร้า ระดับน้อย';
        riskLevel = 'medium';
        recommendation = 'พบแพทย์/พยาบาลจิตเวช ติดตามใกล้ชิด ทำ 9Q ซ้ำใน 2-4 สัปดาห์';
      } else if (s <= 18) {
        result = 'มีอาการของโรคซึมเศร้า ระดับปานกลาง';
        riskLevel = 'high';
        recommendation = 'ส่งต่อจิตแพทย์ พิจารณาให้ยา + จิตบำบัด';
      } else {
        result = 'มีอาการของโรคซึมเศร้า ระดับรุนแรง';
        riskLevel = 'high';
        recommendation = '⚠️ ส่งต่อจิตแพทย์โดยด่วน ประเมินความเสี่ยงฆ่าตัวตาย';
      }
    } else {
      return errResult('ScreeningType ต้องเป็น 2Q หรือ 9Q');
    }

    return {
      success: true,
      data: { score: s, type: t, result, riskLevel, recommendation },
      message: t + ' = ' + s + ' → ' + result,
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    return errResult('แปลความหมายไม่สำเร็จ: ' + err.message);
  }
}

/**
 * detectHighRisk(data) — ตรวจจับความเสี่ยงสูง (ความคิดทำร้ายตนเอง)
 * พิจารณาจาก Q9 ของ 9Q
 * @param {Object} data - {ScreeningType, Q9?, ...}
 * @returns {Object}
 */
function detectHighRisk(data) {
  try {
    if (!data) return errResult('ข้อมูลไม่ถูกต้อง');
    const t = String(data.ScreeningType || '').toUpperCase();

    let highRisk = false;
    let reason = '';
    const warnings = [];

    if (t === '9Q') {
      const q9 = parseInt(data.Q9);
      if (!isNaN(q9) && q9 > 0) {
        highRisk = true;
        reason = 'ตรวจพบความคิดทำร้ายตนเอง (Q9 = ' + q9 + ')';
        warnings.push('⚠️ เร่งด่วน: ผู้ป่วยมีความคิดทำร้ายตนเอง');
        warnings.push('📞 ติดต่อสายด่วนสุขภาพจิต 1323 ทันที');
        warnings.push('👨‍⚕️ ส่งต่อจิตแพทย์/แผนกฉุกเฉินโดยด่วน');
        warnings.push('👨‍👩‍👧 แจ้งครอบครัว/ผู้ดูแลให้เฝ้าระวังตลอด 24 ชม.');
      }
      // ── คะแนนรวมสูงด้วย ──
      const totalScore = parseInt(data.TotalScore);
      if (!isNaN(totalScore) && totalScore >= 19) {
        highRisk = true;
        if (!reason) reason = 'คะแนน 9Q ≥ 19 (รุนแรง)';
        warnings.push('⚠️ ภาวะซึมเศร้ารุนแรง ต้องการการรักษาทันที');
      }
    }

    return okResult({
      highRisk,
      reason,
      warnings,
      hotline: '1323 (สายด่วนสุขภาพจิต)',
      emergency: '1669 (ฉุกเฉินทางการแพทย์)'
    }, highRisk ? '⚠️ ตรวจพบความเสี่ยงสูง' : 'ไม่พบความเสี่ยงสูง');
  } catch (err) {
    return errResult('ตรวจจับความเสี่ยงไม่สำเร็จ: ' + err.message);
  }
}

/**
 * saveMentalHealthScreening(data) — บันทึกการคัดกรองสุขภาพจิต
 * @param {Object} data - {VisitID, ScreeningType:'2Q'|'9Q', Q1..Q9}
 */
function saveMentalHealthScreening(data) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'screening', 'create');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์บันทึกข้อมูล');

    if (!data || typeof data !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');
    if (!data.VisitID) return errResult('ต้องระบุ VisitID');

    const type = String(data.ScreeningType || '').toUpperCase();
    if (type !== '2Q' && type !== '9Q') {
      return errResult('ScreeningType ต้องเป็น 2Q หรือ 9Q');
    }

    const { visit } = _verifyVisit_(data.VisitID, user);

    // ── คำนวณคะแนน ──
    let calcResult, totalScore, q1, q2, q3, q4, q5, q6, q7, q8, q9;
    if (type === '2Q') {
      calcResult = calculate2Q(data);
      if (!calcResult.success) return calcResult;
      totalScore = calcResult.data.totalScore;
      q1 = calcResult.data.q1; q2 = calcResult.data.q2;
      q3 = q4 = q5 = q6 = q7 = q8 = q9 = '';
    } else {
      calcResult = calculate9Q(data);
      if (!calcResult.success) return calcResult;
      totalScore = calcResult.data.totalScore;
      const s = calcResult.data.scores;
      q1 = s.Q1; q2 = s.Q2; q3 = s.Q3; q4 = s.Q4; q5 = s.Q5;
      q6 = s.Q6; q7 = s.Q7; q8 = s.Q8; q9 = s.Q9;
    }

    // ── แปลความหมาย ──
    const interp = interpretMentalHealth(totalScore, type);
    if (!interp.success) return interp;

    // ── ตรวจสอบ high risk ──
    const riskCheck = detectHighRisk({
      ScreeningType: type, Q9: q9, TotalScore: totalScore
    });

    // ── ถ้า high risk จาก suicidal → bump riskLevel เป็น high ──
    let finalRiskLevel = interp.data.riskLevel;
    let finalRecommendation = interp.data.recommendation;
    if (riskCheck.success && riskCheck.data.highRisk) {
      finalRiskLevel = 'high';
      finalRecommendation = riskCheck.data.warnings.join(' | ') + ' | ' + finalRecommendation;
    }

    const mhId = generateId('MH');
    const now = new Date().toISOString();

    const record = {
      MHID:            mhId,
      PatientID:       visit.PatientID,
      VisitID:         data.VisitID,
      AssessmentDate:  data.AssessmentDate || visit.VisitDate || formatDateISO(new Date()),
      ScreeningType:   type,
      Q1: q1, Q2: q2, Q3: q3, Q4: q4, Q5: q5, Q6: q6, Q7: q7, Q8: q8, Q9: q9,
      TotalScore:      totalScore,
      Result:          interp.data.result,
      RiskLevel:       finalRiskLevel,
      Recommendation:  finalRecommendation,
      AssessorID:      user.userId,
      CreatedAt:       now
    };

    const r = appendData(SHEET_NAMES.MENTAL_HEALTH, record);
    if (!r.success) return r;

    _updatePatientSummary_(visit.PatientID, {
      MentalHealthStatus: type + ' ' + totalScore + ' (' + interp.data.result + ')'
    });
    updateData(SHEET_NAMES.VISITS, 'VisitID', data.VisitID, { HasMentalHealth: true });

    writeAuditLog('CREATE', 'screening:mental', mhId, null, {
      visitId: data.VisitID, patientId: visit.PatientID,
      type, totalScore, riskLevel: finalRiskLevel,
      suicidalThought: type === '9Q' && q9 > 0
    });

    return {
      success: true,
      data: {
        mhId,
        screeningType: type,
        totalScore,
        result: interp.data.result,
        riskLevel: finalRiskLevel,
        recommendation: finalRecommendation,
        // ── สำหรับ frontend ใช้ตัดสินใจ ──
        requireFollowUp9Q: (type === '2Q' && totalScore >= 1),
        highRisk: riskCheck.success ? riskCheck.data.highRisk : false,
        warnings: riskCheck.success ? riskCheck.data.warnings : [],
        hotline: '1323 (สายด่วนสุขภาพจิต)',
        emergency: '1669 (ฉุกเฉินทางการแพทย์)'
      },
      message: type + ' = ' + totalScore + ' (' + interp.data.result + ')' +
               (riskCheck.success && riskCheck.data.highRisk ? ' ⚠️ ความเสี่ยงสูง' : ''),
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    Logger.log('saveMentalHealthScreening error: ' + err.stack);
    writeAuditLogFailed_('CREATE', 'screening:mental', '', err.message);
    return errResult('บันทึกการคัดกรองไม่สำเร็จ: ' + err.message);
  }
}

/**
 * getMentalHealthByPatient(patientId) — ดึงประวัติคัดกรองสุขภาพจิต
 */
function getMentalHealthByPatient(patientId) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'screening', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูข้อมูล');

    _checkPatientAccessForRead_(patientId, user);

    const result = findAllData(SHEET_NAMES.MENTAL_HEALTH, r => r.PatientID === patientId);
    if (!result.success) return result;

    const sorted = (result.data || [])
      .sort((a, b) => String(b.AssessmentDate||'').localeCompare(String(a.AssessmentDate||'')))
      .map(_sanitizeAssessment_);

    return {
      success: true,
      data: sorted,
      message: 'พบ ' + sorted.length + ' รายการ',
      disclaimer: ASSESSMENT_DISCLAIMER
    };
  } catch (err) {
    Logger.log('getMentalHealthByPatient error: ' + err.stack);
    return errResult('ดึงข้อมูลไม่สำเร็จ: ' + err.message);
  }
}

// ============================================================
// ── ASSESSMENT META (สำหรับ frontend render) ───────────────
// ============================================================

/**
 * getAssessmentMeta() — ดึง metadata สำหรับ render form
 * รวมรายการคำถาม, ค่าที่อนุญาต, สเกล, disclaimer
 */
function getAssessmentMeta() {
  try {
    return okResult({
      adl: {
        items: ADL_ITEMS.map(item => ({
          key: item,
          maxScore: ADL_MAX_PER_ITEM[item],
          label: _adlLabelThai_(item)
        })),
        maxTotal: 20,
        dependencyThreshold: 11
      },
      pps: {
        levels: [0,10,20,30,40,50,60,70,80,90,100],
        dimensions: ['Ambulation','ActivityDisease','SelfCare','Intake','ConsciousLevel']
      },
      mentalHealth: {
        '2Q': { questions: QUESTIONS_2Q, scoreRange: [0,1], maxTotal: 2, riskThreshold: 1 },
        '9Q': { questions: QUESTIONS_9Q, scoreRange: [0,1,2,3], maxTotal: 27,
                levels: { none:'<7', mild:'7-12', moderate:'13-18', severe:'≥19' },
                suicidalQuestion: 9 }
      },
      disclaimer: ASSESSMENT_DISCLAIMER
    }, 'metadata');
  } catch (err) {
    return errResult('ดึง meta ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * _adlLabelThai_(key) — แปลง key เป็นชื่อภาษาไทย
 * @private
 */
function _adlLabelThai_(key) {
  return ({
    Feeding:'รับประทานอาหาร', Grooming:'ล้างหน้า แปรงฟัน',
    Transfer:'ลุก/ย้ายตัว', ToiletUse:'ใช้ห้องน้ำ',
    Mobility:'การเคลื่อนที่', Dressing:'สวมใส่เสื้อผ้า',
    Stairs:'ขึ้น-ลงบันได', Bathing:'อาบน้ำ',
    Bowels:'กลั้นอุจจาระ', Bladder:'กลั้นปัสสาวะ'
  })[key] || key;
}

// ============================================================
// ── API WRAPPERS (Client-Callable) ──────────────────────────
// ============================================================

function api_saveVitalSigns(token, data) {
  _CURRENT_TOKEN_ = token;
  try { return saveVitalSigns(data); } catch (e) { return errResult(e.message); }
}
function api_getVitalSignsByPatient(token, patientId) {
  _CURRENT_TOKEN_ = token;
  try { return getVitalSignsByPatient(patientId); } catch (e) { return errResult(e.message); }
}

function api_saveADL(token, data) {
  _CURRENT_TOKEN_ = token;
  try { return saveADLAssessment(data); } catch (e) { return errResult(e.message); }
}
function api_getADLByPatient(token, patientId) {
  _CURRENT_TOKEN_ = token;
  try { return getADLByPatient(patientId); } catch (e) { return errResult(e.message); }
}

function api_savePPS(token, data) {
  _CURRENT_TOKEN_ = token;
  try { return savePPSAssessment(data); } catch (e) { return errResult(e.message); }
}
function api_getPPSByPatient(token, patientId) {
  _CURRENT_TOKEN_ = token;
  try { return getPPSByPatient(patientId); } catch (e) { return errResult(e.message); }
}

function api_saveMentalHealth(token, data) {
  _CURRENT_TOKEN_ = token;
  try { return saveMentalHealthScreening(data); } catch (e) { return errResult(e.message); }
}
function api_getMentalHealthByPatient(token, patientId) {
  _CURRENT_TOKEN_ = token;
  try { return getMentalHealthByPatient(patientId); } catch (e) { return errResult(e.message); }
}

function api_getAssessmentMeta(token) {
  _CURRENT_TOKEN_ = token;
  try {
    requireAuth_();
    return getAssessmentMeta();
  } catch (e) { return errResult(e.message); }
}

// ── Interpretation-only helpers (ไม่ต้อง auth — pure calculation) ──
function api_calculateBMI(weight, height) {
  try { return calculateBMI(weight, height); } catch (e) { return errResult(e.message); }
}
function api_interpretBMI(bmi) {
  try { return interpretBMI(bmi); } catch (e) { return errResult(e.message); }
}
function api_interpretBP(sbp, dbp) {
  try { return interpretBP(sbp, dbp); } catch (e) { return errResult(e.message); }
}
function api_interpretDTX(dtx) {
  try { return interpretDTX(dtx); } catch (e) { return errResult(e.message); }
}
function api_interpretADL(totalScore) {
  try { return interpretADL(totalScore); } catch (e) { return errResult(e.message); }
}
function api_classifyTAI(totalScore, hasCognitive) {
  try { return classifyTAI(totalScore, hasCognitive); } catch (e) { return errResult(e.message); }
}
function api_interpretPPS(score) {
  try { return interpretPPS(score); } catch (e) { return errResult(e.message); }
}
function api_calculate2Q(data) {
  try { return calculate2Q(data); } catch (e) { return errResult(e.message); }
}
function api_calculate9Q(data) {
  try { return calculate9Q(data); } catch (e) { return errResult(e.message); }
}
function api_interpretMentalHealth(score, type) {
  try { return interpretMentalHealth(score, type); } catch (e) { return errResult(e.message); }
}
function api_detectHighRisk(data) {
  try { return detectHighRisk(data); } catch (e) { return errResult(e.message); }
}
