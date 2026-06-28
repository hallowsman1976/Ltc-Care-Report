/**
 * ============================================================
 * Auth.gs - Authentication, Authorization, Audit Log
 * ============================================================
 * - Login/Logout ด้วย username/password
 * - Session token เก็บใน CacheService (TTL 8 ชม.)
 * - Permission check ตาม Role Matrix
 * - Audit log ทุก action ที่กระทบข้อมูล
 * ============================================================
 */

// ── Property key สำหรับเก็บ current token (per execution) ──
let _CURRENT_TOKEN_ = null;

/**
 * hashPassword(password) — Hash รหัสผ่านด้วย salt ใหม่
 * คืนทั้ง hash และ salt (เก็บใน Sheet แยกสองคอลัมน์)
 * @param {string} password
 * @returns {Object} {success, data: {hash, salt}, message}
 */
function hashPassword(password) {
  try {
    if (!password || password.length < 6) {
      return { success: false, data: null, message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' };
    }
    const salt = Utilities.getUuid();
    const hash = _computeHash_(password, salt);
    return { success: true, data: { hash, salt }, message: 'Hash รหัสผ่านสำเร็จ' };
  } catch (err) {
    Logger.log('hashPassword error: ' + err);
    return { success: false, data: null, message: 'Hash รหัสผ่านไม่สำเร็จ: ' + err.message };
  }
}

/**
 * verifyPassword(password, salt, expectedHash) — ตรวจสอบรหัสผ่าน
 * @returns {boolean}
 */
function verifyPassword(password, salt, expectedHash) {
  try {
    if (!password || !salt || !expectedHash) return false;
    const computedHash = _computeHash_(password, salt);
    return computedHash === expectedHash;
  } catch (err) {
    Logger.log('verifyPassword error: ' + err);
    return false;
  }
}

/**
 * loginUser(username, password) — เข้าสู่ระบบ
 * - ตรวจสอบ username + password
 * - สร้าง session token (UUID)
 * - เก็บใน CacheService TTL 8 ชม.
 * - อัปเดต LastLoginAt
 * - บันทึก Audit Log
 * @param {string} username
 * @param {string} password
 * @returns {Object} {success, data: {token, user}, message}
 */
function loginUser(username, password) {
  try {
    if (!username || !password) {
      return { success: false, data: null, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };
    }

    const u = String(username).trim().toLowerCase();

    // ── ค้นหา user ──
    const result = findData(SHEET_NAMES.USERS, 'Username', u);
    if (!result.success || !result.data) {
      _logFailedLogin_(u, 'ไม่พบ username');
      return { success: false, data: null, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    }

    const user = result.data;

    // ── ตรวจ IsActive ──
    const active = user.IsActive === true || user.IsActive === 'true' || user.IsActive === 'TRUE';
    if (!active) {
      _logFailedLogin_(u, 'บัญชีถูกปิดใช้งาน');
      return { success: false, data: null, message: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ' };
    }

    // ── ตรวจรหัสผ่าน ──
    if (!verifyPassword(password, user.PasswordSalt, user.PasswordHash)) {
      _logFailedLogin_(u, 'รหัสผ่านไม่ถูกต้อง');
      return { success: false, data: null, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    }

    // ── สร้าง Session Token ──
    const token = Utilities.getUuid();
    const sessionData = {
      userId: user.UserID,
      username: user.Username,
      fullName: user.FullName,
      role: user.Role,
      orgName: user.OrgName,
      phone: user.Phone,
      loginAt: new Date().toISOString()
    };

    CacheService.getScriptCache().put(
      SESSION_CACHE_KEY_PREFIX + token,
      JSON.stringify(sessionData),
      SESSION_TTL_SECONDS
    );

    _CURRENT_TOKEN_ = token;

    // ── อัปเดต LastLoginAt ──
    updateData(SHEET_NAMES.USERS, 'UserID', user.UserID, {
      LastLoginAt: new Date().toISOString()
    });

    // ── Audit Log ──
    writeAuditLog('LOGIN', 'auth', user.UserID, null, { username: u, role: user.Role });

    return {
      success: true,
      data: { token, user: sessionData },
      message: 'เข้าสู่ระบบสำเร็จ ยินดีต้อนรับคุณ ' + user.FullName
    };
  } catch (err) {
    Logger.log('loginUser error: ' + err.stack);
    return { success: false, data: null, message: 'เข้าสู่ระบบไม่สำเร็จ: ' + err.message };
  }
}

/**
 * logoutUser(token?) — ออกจากระบบ
 * ลบ session token จาก cache
 * @param {string} [token] - ถ้าไม่ส่ง จะใช้ _CURRENT_TOKEN_
 * @returns {Object} {success, data, message}
 */
function logoutUser(token) {
  try {
    const t = token || _CURRENT_TOKEN_;
    if (!t) return { success: true, data: null, message: 'ออกจากระบบแล้ว' };

    // ── ดึง user ก่อนลบเพื่อ audit ──
    const cached = CacheService.getScriptCache().get(SESSION_CACHE_KEY_PREFIX + t);
    let userId = null;
    if (cached) {
      try { userId = JSON.parse(cached).userId; } catch(e){}
    }

    CacheService.getScriptCache().remove(SESSION_CACHE_KEY_PREFIX + t);
    _CURRENT_TOKEN_ = null;

    if (userId) {
      writeAuditLog('LOGOUT', 'auth', userId, null, null);
    }

    return { success: true, data: null, message: 'ออกจากระบบสำเร็จ' };
  } catch (err) {
    Logger.log('logoutUser error: ' + err);
    return { success: false, data: null, message: 'ออกจากระบบไม่สำเร็จ: ' + err.message };
  }
}

/**
 * getCurrentUser(token?) — ดึงข้อมูลผู้ใช้ปัจจุบันจาก session
 * @param {string} [token]
 * @returns {Object} {success, data: {user} | null, message}
 */
function getCurrentUser(token) {
  try {
    const t = token || _CURRENT_TOKEN_;
    if (!t) return { success: false, data: null, message: 'ยังไม่ได้เข้าสู่ระบบ' };

    const cached = CacheService.getScriptCache().get(SESSION_CACHE_KEY_PREFIX + t);
    if (!cached) {
      return { success: false, data: null, message: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' };
    }

    let sessionData;
    try { sessionData = JSON.parse(cached); }
    catch (e) {
      return { success: false, data: null, message: 'Session เสียหาย กรุณาเข้าสู่ระบบใหม่' };
    }

    _CURRENT_TOKEN_ = t;

    // ── ต่ออายุ session (sliding expiration) ──
    CacheService.getScriptCache().put(
      SESSION_CACHE_KEY_PREFIX + t,
      cached,
      SESSION_TTL_SECONDS
    );

    return { success: true, data: sessionData, message: 'ผู้ใช้ปัจจุบัน' };
  } catch (err) {
    Logger.log('getCurrentUser error: ' + err);
    return { success: false, data: null, message: 'ดึงข้อมูลผู้ใช้ไม่สำเร็จ: ' + err.message };
  }
}

/**
 * requireAuth_(token) — Helper สำหรับ API ที่ต้องการ auth (throw ถ้าไม่ผ่าน)
 * คืน user object ถ้าผ่าน
 * @private
 */
function requireAuth_(token) {
  const result = getCurrentUser(token);
  if (!result.success || !result.data) {
    throw new Error(result.message || 'ต้องเข้าสู่ระบบก่อน');
  }
  return result.data;
}

/**
 * checkPermission(role, module, action) — ตรวจสอบสิทธิ์ตาม Permission Matrix
 * @param {string} role - admin / cm / cg / viewer
 * @param {string} module - patient / careplan / visit / screening / benefit / photo / report / audit / user / setting / notification
 * @param {string} action - read / create / update / delete / approve / export
 * @returns {Object} {success, data: {allowed: boolean}, message}
 */
function checkPermission(role, module, action) {
  try {
    if (!role || !module || !action) {
      return { success: false, data: { allowed: false }, message: 'พารามิเตอร์ไม่ครบ' };
    }
    const roleMatrix = PERMISSION_MATRIX[role];
    if (!roleMatrix) {
      return { success: false, data: { allowed: false }, message: 'ไม่รู้จัก role: ' + role };
    }
    const allowedActions = roleMatrix[module];
    if (!allowedActions) {
      return { success: true, data: { allowed: false }, message: 'ไม่มีสิทธิ์เข้าถึง module นี้' };
    }
    const allowed = allowedActions.includes(action);
    return {
      success: true,
      data: { allowed },
      message: allowed ? 'มีสิทธิ์' : 'ไม่มีสิทธิ์ ' + action + ' ใน module ' + module
    };
  } catch (err) {
    Logger.log('checkPermission error: ' + err);
    return { success: false, data: { allowed: false }, message: 'ตรวจสอบสิทธิ์ไม่สำเร็จ: ' + err.message };
  }
}

/**
 * requirePermission_(token, module, action) — Helper สำหรับ API
 * throw ถ้าไม่มีสิทธิ์
 * @private
 */
function requirePermission_(token, module, action) {
  const user = requireAuth_(token);
  const check = checkPermission(user.role, module, action);
  if (!check.data || !check.data.allowed) {
    throw new Error('ไม่มีสิทธิ์: ' + (check.message || (module + '.' + action)));
  }
  return user;
}

/**
 * writeAuditLog(action, module, recordId, oldValue, newValue) — บันทึก Audit Log
 * @param {string} action - LOGIN / LOGOUT / CREATE / UPDATE / DELETE / READ / EXPORT / APPROVE / SEND_LINE / SETUP
 * @param {string} module - entity type ที่กระทบ (auth, patient, visit, ...)
 * @param {string} recordId - PK ของ record ที่ถูกกระทำ
 * @param {*} oldValue - ค่าก่อน (object หรือ string)
 * @param {*} newValue - ค่าหลัง (object หรือ string)
 * @returns {Object} {success, data, message}
 */
function writeAuditLog(action, module, recordId, oldValue, newValue) {
  try {
    if (!action) return { success: false, data: null, message: 'action ห้ามว่าง' };

    let username = 'SYSTEM';
    let userId = 'SYSTEM';

    // ── ดึง user จาก current session (ถ้ามี) ──
    try {
      if (_CURRENT_TOKEN_) {
        const cached = CacheService.getScriptCache().get(SESSION_CACHE_KEY_PREFIX + _CURRENT_TOKEN_);
        if (cached) {
          const session = JSON.parse(cached);
          username = session.username || 'SYSTEM';
          userId = session.userId || 'SYSTEM';
        }
      }
    } catch (e) {}

    const sheet = getSheet(SHEET_NAMES.AUDIT_LOG);
    const logId = generateId('LOG');
    const timestamp = new Date().toISOString();

    sheet.appendRow([
      logId,
      timestamp,
      userId,
      username,
      String(action).toUpperCase(),
      module || '',
      recordId || '',
      '',                                            // Details
      _stringifyForLog_(oldValue),                   // OldValue
      _stringifyForLog_(newValue),                   // NewValue
      'success',                                     // Result
      '',                                            // ErrorMessage
      ''                                             // IPAddress (GAS ไม่มี req IP)
    ]);

    return { success: true, data: { logId }, message: 'บันทึก Audit Log สำเร็จ' };
  } catch (err) {
    Logger.log('writeAuditLog error: ' + err);
    // ไม่ throw ป้องกัน audit error ทำให้ business logic พัง
    return { success: false, data: null, message: 'บันทึก Audit Log ไม่สำเร็จ: ' + err.message };
  }
}

/**
 * writeAuditLogFailed_() — บันทึก Audit Log แบบ failed
 * @private
 */
function writeAuditLogFailed_(action, module, recordId, errorMessage) {
  try {
    let username = 'SYSTEM';
    let userId = 'SYSTEM';
    try {
      if (_CURRENT_TOKEN_) {
        const cached = CacheService.getScriptCache().get(SESSION_CACHE_KEY_PREFIX + _CURRENT_TOKEN_);
        if (cached) {
          const session = JSON.parse(cached);
          username = session.username || 'SYSTEM';
          userId = session.userId || 'SYSTEM';
        }
      }
    } catch (e) {}

    const sheet = getSheet(SHEET_NAMES.AUDIT_LOG);
    sheet.appendRow([
      generateId('LOG'),
      new Date().toISOString(),
      userId, username,
      String(action).toUpperCase(),
      module || '', recordId || '',
      '', '', '',
      'failed',
      String(errorMessage || ''),
      ''
    ]);
  } catch (e) {}
}

/**
 * _logFailedLogin_() — บันทึก login ที่ล้มเหลว
 * @private
 */
function _logFailedLogin_(username, reason) {
  try {
    const sheet = getSheet(SHEET_NAMES.AUDIT_LOG);
    sheet.appendRow([
      generateId('LOG'),
      new Date().toISOString(),
      'UNKNOWN', String(username || 'unknown'),
      'LOGIN', 'auth', '',
      'Failed login attempt', '', '',
      'failed',
      String(reason || ''),
      ''
    ]);
  } catch (e) {}
}

/**
 * api_getCaregivers(token) — ดึงรายชื่อ cm/cg ที่ active (สำหรับ dropdown)
 * คืนเฉพาะ field ที่ไม่ sensitive
 */
function api_getCaregivers(token) {
  _CURRENT_TOKEN_ = token;
  try {
    requireAuth_();
    const r = findAllData(SHEET_NAMES.USERS, u => {
      const active = u.IsActive === true || u.IsActive === 'true' || u.IsActive === 'TRUE';
      return active && (u.Role === 'cm' || u.Role === 'cg' || u.Role === 'admin');
    });
    if (!r.success) return r;
    const list = (r.data || []).map(u => ({
      userId: u.UserID, fullName: u.FullName, role: u.Role, phone: u.Phone || ''
    }));
    return okResult(list, 'รายชื่อผู้ใช้');
  } catch (err) {
    return errResult(err.message);
  }
}

/**
 * _stringifyForLog_() — แปลง value เป็น string ปลอดภัยสำหรับ log
 * ลบ field sensitive ออก
 * @private
 */
function _stringifyForLog_(value) {
  try {
    if (value == null) return '';
    if (typeof value === 'string') return value.substring(0, 500);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    // Object: ลบ sensitive field
    const cleaned = {};
    Object.entries(value).forEach(([k, v]) => {
      if (['PasswordHash','PasswordSalt','password','CID'].includes(k)) {
        cleaned[k] = '***REDACTED***';
      } else if (v instanceof Date) {
        cleaned[k] = v.toISOString();
      } else if (typeof v !== 'function') {
        cleaned[k] = v;
      }
    });
    const json = JSON.stringify(cleaned);
    return json.length > 1000 ? json.substring(0, 1000) + '...' : json;
  } catch (err) {
    return String(value);
  }
}
