/**
 * ============================================================
 * MessagingService.gs - LINE Messaging API + Notifications
 * ============================================================
 * - ส่งข้อความแจ้งเตือนผ่าน LINE Messaging API (push)
 * - บันทึกสถานะทุกครั้งใน Notifications sheet
 * - ฟังก์ชันแจ้งเตือนอัตโนมัติ (ใช้กับ time-based trigger)
 * - จัดการ Settings (getSettingValue_ / setSettingValue_)
 * - Audit Log ทุกการส่ง
 * ============================================================
 */

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

// ============================================================
// ── SETTINGS HELPERS (ใช้ร่วมทั้งระบบ) ──────────────────────
// ============================================================

/**
 * getSettingValue_(key, def) — อ่านค่า setting รายตัว (มี default)
 * @private
 */
function getSettingValue_(key, def) {
  try {
    const r = findData(SHEET_NAMES.SETTING, 'SettingKey', key);
    if (r.success && r.data && r.data.SettingValue !== '' && r.data.SettingValue != null) {
      return String(r.data.SettingValue);
    }
  } catch (e) {}
  return (def === undefined) ? '' : def;
}

/**
 * setSettingValue_(key, value, user) — เขียน/อัปเดตค่า setting (upsert)
 * @private
 */
function setSettingValue_(key, value, user) {
  const now = new Date().toISOString();
  const by = (user && user.userId) ? user.userId : 'SYSTEM';
  const exists = findData(SHEET_NAMES.SETTING, 'SettingKey', key);
  if (exists.success && exists.data) {
    return updateData(SHEET_NAMES.SETTING, 'SettingKey', key, {
      SettingValue: value, UpdatedAt: now, UpdatedBy: by
    });
  }
  return appendData(SHEET_NAMES.SETTING, {
    SettingKey: key, SettingValue: value, DataType: 'text',
    Description: '', UpdatedAt: now, UpdatedBy: by
  });
}

/**
 * _getUserMap_() — แมป UserID → {fullName, phone, role} (ใช้ร่วมหลาย service)
 * @private
 */
function _getUserMap_() {
  const map = {};
  try {
    const r = findAllData(SHEET_NAMES.USERS);
    if (r.success) {
      r.data.forEach(u => {
        map[u.UserID] = { fullName: u.FullName, phone: u.Phone || '', role: u.Role };
      });
    }
  } catch (e) {}
  return map;
}

// ── keys ที่ต้อง mask เวลาแสดงผล ──
const SENSITIVE_SETTING_KEYS = ['LINE_CHANNEL_ACCESS_TOKEN','LINE_NOTIFY_TOKEN','TOKEN','SECRET'];

function _isSensitiveKey_(key) {
  return SENSITIVE_SETTING_KEYS.some(s => String(key).toUpperCase().includes(s));
}

function _maskToken_(v) {
  const s = String(v || '');
  if (!s) return '';
  if (s.length <= 6) return '••••••';
  return '••••••••' + s.slice(-4);
}

// ============================================================
// ── SETTINGS API (admin) ────────────────────────────────────
// ============================================================

/**
 * api_getSettings(token) — ดึง settings ทั้งหมด (admin) — mask token
 */
function api_getSettings(token) {
  _CURRENT_TOKEN_ = token;
  try {
    requirePermission_(token, 'setting', 'read');
    const r = findAllData(SHEET_NAMES.SETTING);
    if (!r.success) return r;
    const settings = {};
    const masked = {};
    (r.data || []).forEach(s => {
      if (_isSensitiveKey_(s.SettingKey)) {
        settings[s.SettingKey] = _maskToken_(s.SettingValue);
        masked[s.SettingKey] = true;
      } else {
        settings[s.SettingKey] = s.SettingValue;
      }
    });
    return okResult({ settings, masked }, 'การตั้งค่าระบบ');
  } catch (err) {
    return errResult(err.message);
  }
}

/**
 * api_saveSettings(token, obj) — บันทึก settings (admin)
 * ข้ามค่า token ที่ยังเป็น masked placeholder (ขึ้นต้นด้วย ••)
 */
function api_saveSettings(token, obj) {
  _CURRENT_TOKEN_ = token;
  try {
    const user = requirePermission_(token, 'setting', 'update');
    if (!obj || typeof obj !== 'object') return errResult('ข้อมูลไม่ถูกต้อง');

    const saved = [];
    Object.entries(obj).forEach(([key, value]) => {
      // ── ถ้าเป็น token ที่ไม่ถูกแก้ (ยังเป็น mask) → ข้าม ──
      if (_isSensitiveKey_(key) && String(value).indexOf('••') === 0) return;
      const r = setSettingValue_(key, value, user);
      if (r.success) saved.push(key);
    });

    writeAuditLog('UPDATE', 'setting', 'settings', null, { keys: saved });
    return okResult({ saved }, 'บันทึกการตั้งค่าสำเร็จ ' + saved.length + ' รายการ');
  } catch (err) {
    Logger.log('api_saveSettings error: ' + err.stack);
    writeAuditLogFailed_('UPDATE', 'setting', 'settings', err.message);
    return errResult(err.message);
  }
}

// ============================================================
// ── NOTIFICATION RECORD ─────────────────────────────────────
// ============================================================

/**
 * _recordNotification_(opts) — บันทึก Notification ลง sheet
 * @private
 */
function _recordNotification_(opts) {
  try {
    const id = generateId('NTF');
    const now = new Date().toISOString();
    appendData(SHEET_NAMES.NOTIFICATION, {
      NotificationID:  id,
      PatientID:       opts.patientId || '',
      VisitID:         opts.visitId || '',
      NotificationType: opts.type || 'SYSTEM',
      Title:           opts.title || '',
      Message:         opts.message || '',
      Channel:         opts.channel || 'LINE',
      RecipientUserID: opts.recipient || '',
      ScheduledAt:     opts.scheduledAt || '',
      SentAt:          opts.status === 'sent' ? now : '',
      Status:          opts.status || 'pending',
      LineStatusCode:  opts.code || '',
      LineResponse:    String(opts.response || '').substring(0, 500),
      CreatedBy:       (function(){ try { return JSON.parse(CacheService.getScriptCache().get(SESSION_CACHE_KEY_PREFIX + _CURRENT_TOKEN_)).userId; } catch(e){ return 'SYSTEM'; } })(),
      CreatedAt:       now
    });
    return id;
  } catch (e) {
    Logger.log('_recordNotification_ error: ' + e);
    return null;
  }
}

// ============================================================
// ── LINE PUSH ───────────────────────────────────────────────
// ============================================================

/**
 * sendLineAlert(message, target, meta) — ส่งข้อความผ่าน LINE Messaging API
 * @param {string} message - ข้อความ
 * @param {string} [target] - LINE group/user id (ถ้าไม่ระบุใช้ LINE_GROUP_ID)
 * @param {Object} [meta] - {type, title, patientId, visitId}
 * @returns {Object} {success, data, message}
 */
function sendLineAlert(message, target, meta) {
  meta = meta || {};
  try {
    if (!message) return errResult('ข้อความว่างเปล่า');

    const token = getSettingValue_('LINE_CHANNEL_ACCESS_TOKEN');
    const to = target || getSettingValue_('LINE_GROUP_ID');

    if (!token || !to) {
      _recordNotification_({
        type: meta.type || 'LINE_ALERT', title: meta.title || '',
        message, channel:'LINE', status:'failed',
        response:'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_GROUP_ID',
        patientId: meta.patientId, visitId: meta.visitId
      });
      return errResult('ยังไม่ได้ตั้งค่า LINE (Token / Group ID) ในหน้าตั้งค่า');
    }

    const resp = UrlFetchApp.fetch(LINE_PUSH_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: message }] }),
      muteHttpExceptions: true
    });

    const code = resp.getResponseCode();
    const body = resp.getContentText();
    const ok = (code === 200);

    const ntfId = _recordNotification_({
      type: meta.type || 'LINE_ALERT', title: meta.title || '',
      message, channel:'LINE',
      status: ok ? 'sent' : 'failed',
      code, response: body,
      patientId: meta.patientId, visitId: meta.visitId
    });

    writeAuditLog('SEND_LINE', 'notification', ntfId || '', null,
      { to: String(to).substring(0,8)+'...', code, ok });

    return ok
      ? okResult({ notificationId: ntfId, code }, 'ส่ง LINE สำเร็จ')
      : errResult('ส่ง LINE ไม่สำเร็จ (HTTP ' + code + '): ' + body, { notificationId: ntfId });
  } catch (err) {
    Logger.log('sendLineAlert error: ' + err.stack);
    _recordNotification_({
      type: meta.type || 'LINE_ALERT', message, channel:'LINE',
      status:'failed', response: err.message,
      patientId: meta.patientId, visitId: meta.visitId
    });
    return errResult('ส่ง LINE ผิดพลาด: ' + err.message);
  }
}

/**
 * api_sendLineAlert(token, message, target) — admin/cm ส่งข้อความเอง
 */
function api_sendLineAlert(token, message, target) {
  _CURRENT_TOKEN_ = token;
  try {
    requirePermission_(token, 'notification', 'create');
    if (!message || !String(message).trim()) return errResult('กรุณาพิมพ์ข้อความ');
    return sendLineAlert(message, target || '', { type:'LINE_ALERT', title:'ข้อความจากผู้ดูแล' });
  } catch (err) {
    return errResult(err.message);
  }
}

// ============================================================
// ── AUTOMATED NOTIFICATIONS (trigger-friendly) ──────────────
// ============================================================

/**
 * notifyUpcomingVisits(days) — แจ้งเตือนนัดเยี่ยมที่ใกล้ครบกำหนด
 */
function notifyUpcomingVisits(days) {
  try {
    const daysAhead = parseInt(days) || 3;
    const patients = findAllData(SHEET_NAMES.PATIENTS, r => {
      const s = String(r.Status||'').toLowerCase(); return s !== 'deleted' && s !== 'inactive';
    });
    if (!patients.success) return patients;
    const pmap = {}; patients.data.forEach(p => pmap[p.PatientID] = p);

    const visits = findAllData(SHEET_NAMES.VISITS, r => pmap[r.PatientID]);
    const latest = {};
    (visits.data || []).forEach(v => {
      const c = latest[v.PatientID];
      if (!c || (parseInt(v.VisitNo)||0) > (parseInt(c.VisitNo)||0)) latest[v.PatientID] = v;
    });

    const today = formatDateISO(new Date());
    const cutoff = formatDateISO(new Date(Date.now() + daysAhead*86400000));
    const lines = [];
    Object.values(latest).forEach(v => {
      const next = String(v.NextVisitDate||'').split('T')[0];
      if (next && next >= today && next <= cutoff) {
        const p = pmap[v.PatientID];
        lines.push('• ' + p.FullName + ' (ม.' + (p.VillageNo||'-') + ') นัด ' + formatDateThai(next));
      }
    });

    if (!lines.length) return okResult({ count:0 }, 'ไม่มีนัดที่ใกล้ครบกำหนด');
    const msg = '📅 แจ้งเตือนนัดเยี่ยมใน ' + daysAhead + ' วัน (' + lines.length + ' ราย)\n' + lines.join('\n');
    sendLineAlert(msg, '', { type:'VISIT_DUE', title:'นัดเยี่ยมใกล้ครบกำหนด' });
    return okResult({ count: lines.length }, 'แจ้งเตือน ' + lines.length + ' ราย');
  } catch (err) {
    Logger.log('notifyUpcomingVisits error: ' + err.stack);
    return errResult(err.message);
  }
}

/**
 * notifyOverdueVisits() — แจ้งเตือนเคสเลยกำหนดเยี่ยม
 */
function notifyOverdueVisits() {
  try {
    const patients = findAllData(SHEET_NAMES.PATIENTS, r => {
      const s = String(r.Status||'').toLowerCase(); return s !== 'deleted' && s !== 'inactive';
    });
    if (!patients.success) return patients;
    const pmap = {}; patients.data.forEach(p => pmap[p.PatientID] = p);

    const visits = findAllData(SHEET_NAMES.VISITS, r => pmap[r.PatientID]);
    const latest = {};
    (visits.data || []).forEach(v => {
      const c = latest[v.PatientID];
      if (!c || (parseInt(v.VisitNo)||0) > (parseInt(c.VisitNo)||0)) latest[v.PatientID] = v;
    });

    const today = formatDateISO(new Date());
    const lines = [];
    Object.values(latest).forEach(v => {
      const next = String(v.NextVisitDate||'').split('T')[0];
      if (next && next < today) {
        const p = pmap[v.PatientID];
        const od = Math.floor((new Date(today) - new Date(next)) / 86400000);
        lines.push('• ' + p.FullName + ' (ม.' + (p.VillageNo||'-') + ') เลย ' + od + ' วัน');
      }
    });

    if (!lines.length) return okResult({ count:0 }, 'ไม่มีเคสเลยกำหนด');
    const msg = '⚠️ เคสเลยกำหนดเยี่ยม (' + lines.length + ' ราย)\n' + lines.join('\n');
    sendLineAlert(msg, '', { type:'OVERDUE', title:'เคสเลยกำหนดเยี่ยม' });
    return okResult({ count: lines.length }, 'แจ้งเตือน ' + lines.length + ' ราย');
  } catch (err) {
    Logger.log('notifyOverdueVisits error: ' + err.stack);
    return errResult(err.message);
  }
}

/**
 * notifyHighRiskMentalHealth() — แจ้งเตือนผู้ป่วยสุขภาพจิตเสี่ยงสูง (ล่าสุด 7 วัน)
 */
function notifyHighRiskMentalHealth() {
  try {
    const cutoff = formatDateISO(new Date(Date.now() - 7*86400000));
    const mh = findAllData(SHEET_NAMES.MENTAL_HEALTH, r =>
      String(r.RiskLevel||'').toLowerCase() === 'high' &&
      String(r.AssessmentDate||'').split('T')[0] >= cutoff
    );
    if (!mh.success || !mh.data.length) return okResult({ count:0 }, 'ไม่มีเคสเสี่ยงสูง');

    const pmap = {};
    findAllData(SHEET_NAMES.PATIENTS).data.forEach(p => pmap[p.PatientID] = p);

    const lines = mh.data.map(m => {
      const p = pmap[m.PatientID] || {};
      return '• ' + (p.FullName||m.PatientID) + ' — ' + m.ScreeningType + ' ' + m.TotalScore + ' (' + m.Result + ')';
    });
    const msg = '🚨 ผู้ป่วยสุขภาพจิตเสี่ยงสูง (' + lines.length + ' ราย)\n' + lines.join('\n') +
                '\n\n📞 สายด่วนสุขภาพจิต 1323';
    sendLineAlert(msg, '', { type:'URGENT', title:'สุขภาพจิตเสี่ยงสูง' });
    return okResult({ count: lines.length }, 'แจ้งเตือน ' + lines.length + ' ราย');
  } catch (err) {
    Logger.log('notifyHighRiskMentalHealth error: ' + err.stack);
    return errResult(err.message);
  }
}

/**
 * notifyAbnormalVitalSigns() — แจ้งเตือนสัญญาณชีพผิดปกติ (ล่าสุด 3 วัน)
 * เกณฑ์: SBP>180 หรือ <90, DBP>120, DTX<70 หรือ >300, SpO2<92
 */
function notifyAbnormalVitalSigns() {
  try {
    const cutoff = formatDateISO(new Date(Date.now() - 3*86400000));
    const vs = findAllData(SHEET_NAMES.VITAL_SIGNS, r =>
      String(r.VisitDate||'').split('T')[0] >= cutoff
    );
    if (!vs.success || !vs.data.length) return okResult({ count:0 }, 'ไม่มีข้อมูล');

    const pmap = {};
    findAllData(SHEET_NAMES.PATIENTS).data.forEach(p => pmap[p.PatientID] = p);

    const lines = [];
    vs.data.forEach(v => {
      const sbp = parseInt(v.SBP), dbp = parseInt(v.DBP), dtx = parseInt(v.DTX), spo2 = parseInt(v.OxygenSat);
      const abn = [];
      if (!isNaN(sbp) && (sbp > 180 || sbp < 90)) abn.push('SBP ' + sbp);
      if (!isNaN(dbp) && dbp > 120) abn.push('DBP ' + dbp);
      if (!isNaN(dtx) && (dtx < 70 || dtx > 300)) abn.push('DTX ' + dtx);
      if (!isNaN(spo2) && spo2 < 92) abn.push('SpO2 ' + spo2 + '%');
      if (abn.length) {
        const p = pmap[v.PatientID] || {};
        lines.push('• ' + (p.FullName||v.PatientID) + ' — ' + abn.join(', '));
      }
    });

    if (!lines.length) return okResult({ count:0 }, 'ไม่พบสัญญาณชีพผิดปกติ');
    const msg = '🩺 สัญญาณชีพผิดปกติ (' + lines.length + ' ราย)\n' + lines.join('\n');
    sendLineAlert(msg, '', { type:'URGENT', title:'สัญญาณชีพผิดปกติ' });
    return okResult({ count: lines.length }, 'แจ้งเตือน ' + lines.length + ' ราย');
  } catch (err) {
    Logger.log('notifyAbnormalVitalSigns error: ' + err.stack);
    return errResult(err.message);
  }
}

/**
 * notifyPPSDecline() — แจ้งเตือนผู้ป่วยที่ PPS ลดลง (เทียบ 2 ครั้งล่าสุด)
 */
function notifyPPSDecline() {
  try {
    const pps = findAllData(SHEET_NAMES.PPSA);
    if (!pps.success || !pps.data.length) return okResult({ count:0 }, 'ไม่มีข้อมูล PPS');

    // ── จัดกลุ่มตาม patient เรียงวันที่ ──
    const byPatient = {};
    pps.data.forEach(p => {
      (byPatient[p.PatientID] = byPatient[p.PatientID] || []).push(p);
    });

    const pmap = {};
    findAllData(SHEET_NAMES.PATIENTS).data.forEach(p => pmap[p.PatientID] = p);

    const lines = [];
    Object.entries(byPatient).forEach(([pid, list]) => {
      if (list.length < 2) return;
      list.sort((a,b) => String(b.AssessmentDate||'').localeCompare(String(a.AssessmentDate||'')));
      const cur = parseInt(list[0].PPSScore), prev = parseInt(list[1].PPSScore);
      if (!isNaN(cur) && !isNaN(prev) && cur < prev) {
        const p = pmap[pid] || {};
        lines.push('• ' + (p.FullName||pid) + ' — PPS ' + prev + '% → ' + cur + '% (ลดลง ' + (prev-cur) + ')');
      }
    });

    if (!lines.length) return okResult({ count:0 }, 'ไม่มีเคส PPS ลดลง');
    const msg = '📉 ผู้ป่วยที่ PPS ลดลง (' + lines.length + ' ราย)\n' + lines.join('\n');
    sendLineAlert(msg, '', { type:'FOLLOW_UP', title:'PPS ลดลง' });
    return okResult({ count: lines.length }, 'แจ้งเตือน ' + lines.length + ' ราย');
  } catch (err) {
    Logger.log('notifyPPSDecline error: ' + err.stack);
    return errResult(err.message);
  }
}

// ============================================================
// ── API WRAPPERS (admin/cm) ─────────────────────────────────
// ============================================================

function api_notifyUpcomingVisits(token, days) {
  _CURRENT_TOKEN_ = token;
  try { requirePermission_(token, 'notification', 'create'); return notifyUpcomingVisits(days); }
  catch (e) { return errResult(e.message); }
}
function api_notifyOverdueVisits(token) {
  _CURRENT_TOKEN_ = token;
  try { requirePermission_(token, 'notification', 'create'); return notifyOverdueVisits(); }
  catch (e) { return errResult(e.message); }
}
function api_notifyHighRiskMentalHealth(token) {
  _CURRENT_TOKEN_ = token;
  try { requirePermission_(token, 'notification', 'create'); return notifyHighRiskMentalHealth(); }
  catch (e) { return errResult(e.message); }
}
function api_notifyAbnormalVitalSigns(token) {
  _CURRENT_TOKEN_ = token;
  try { requirePermission_(token, 'notification', 'create'); return notifyAbnormalVitalSigns(); }
  catch (e) { return errResult(e.message); }
}
function api_notifyPPSDecline(token) {
  _CURRENT_TOKEN_ = token;
  try { requirePermission_(token, 'notification', 'create'); return notifyPPSDecline(); }
  catch (e) { return errResult(e.message); }
}

/**
 * api_getNotifications(token, limit) — ดึงประวัติการแจ้งเตือน
 */
function api_getNotifications(token, limit) {
  _CURRENT_TOKEN_ = token;
  try {
    requirePermission_(token, 'notification', 'read');
    const r = findAllData(SHEET_NAMES.NOTIFICATION);
    if (!r.success) return r;
    const max = parseInt(limit) || 100;
    const data = (r.data || [])
      .sort((a, b) => String(b.CreatedAt||'').localeCompare(String(a.CreatedAt||'')))
      .slice(0, max)
      .map(n => { delete n.__rowIndex; return n; });
    return okResult(data, 'พบ ' + data.length + ' รายการ');
  } catch (err) {
    return errResult(err.message);
  }
}

/**
 * api_resendNotification(token, notificationId) — ส่งซ้ำ (admin)
 */
function api_resendNotification(token, notificationId) {
  _CURRENT_TOKEN_ = token;
  try {
    const user = requirePermission_(token, 'notification', 'create');
    if (user.role !== 'admin') return errResult('เฉพาะ admin เท่านั้นที่ส่งซ้ำได้');

    const r = findData(SHEET_NAMES.NOTIFICATION, 'NotificationID', notificationId);
    if (!r.success || !r.data) return errResult('ไม่พบการแจ้งเตือน');

    const result = sendLineAlert(r.data.Message, '', {
      type: r.data.NotificationType, title: r.data.Title,
      patientId: r.data.PatientID, visitId: r.data.VisitID
    });
    writeAuditLog('SEND_LINE', 'notification', notificationId, null, { resend: true, ok: result.success });
    return result.success
      ? okResult(result.data, 'ส่งซ้ำสำเร็จ')
      : errResult(result.message);
  } catch (err) {
    return errResult(err.message);
  }
}
