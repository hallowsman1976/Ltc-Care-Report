/**
 * ============================================================
 * Api.gs - RPC Entry Points (Client-Callable)
 * ============================================================
 * Endpoints ที่ Frontend (Alpine.js) เรียกผ่าน google.script.run
 *
 * Convention:
 * - ทุก function ต้องคืน { success: boolean, data: any|null, message: string }
 * - ทุก function ต้อง try/catch ครอบ ไม่ throw ออก client
 * - ฟังก์ชันที่ต้อง auth จะรับ token เป็น parameter แรก
 * - สำหรับ Phase 2 เน้น Auth, Setup, Utility — module CRUD จะอยู่ใน Phase 3+
 * ============================================================
 */

// ============================================================
// ── SYSTEM / SETUP ──────────────────────────────────────────
// ============================================================

/**
 * api_ping() — Health check
 */
function api_ping() {
  try {
    return okResult({
      app: APP_NAME,
      version: APP_VERSION,
      time: new Date().toISOString(),
      timezone: Session.getScriptTimeZone()
    }, 'pong');
  } catch (err) {
    return errResult('Ping ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * api_setupSheets() — Trigger setup จากหน้า client (admin เท่านั้น)
 * เรียกครั้งแรกตอนติดตั้งระบบ
 */
function api_setupSheets() {
  try {
    return setupSheets();
  } catch (err) {
    Logger.log('api_setupSheets error: ' + err.stack);
    return errResult('ตั้งค่าระบบไม่สำเร็จ: ' + err.message);
  }
}

/**
 * api_getAppConfig() — ข้อมูลพื้นฐานของระบบ (ไม่ต้อง auth)
 * ใช้ตอนแสดงหน้า Login เพื่อแสดงชื่อองค์กร, เวอร์ชัน
 */
function api_getAppConfig() {
  try {
    const result = findAllData(SHEET_NAMES.SETTING);
    const settings = {};
    if (result.success && result.data) {
      result.data.forEach(s => {
        // ── เปิดเผยเฉพาะ setting ที่ไม่ sensitive ──
        if (!['LINE_NOTIFY_TOKEN'].includes(s.SettingKey)) {
          settings[s.SettingKey] = s.SettingValue;
        }
      });
    }
    return okResult({
      app: APP_NAME,
      version: APP_VERSION,
      settings: settings
    }, 'ข้อมูลระบบ');
  } catch (err) {
    return errResult('ดึงข้อมูลระบบไม่สำเร็จ: ' + err.message);
  }
}

// ============================================================
// ── AUTH ENDPOINTS ──────────────────────────────────────────
// ============================================================

/**
 * api_login(username, password) — เข้าสู่ระบบ
 * @returns {Object} {success, data: {token, user}, message}
 */
function api_login(username, password) {
  try {
    return loginUser(username, password);
  } catch (err) {
    Logger.log('api_login error: ' + err.stack);
    return errResult('เข้าสู่ระบบไม่สำเร็จ: ' + err.message);
  }
}

/**
 * api_logout(token) — ออกจากระบบ
 */
function api_logout(token) {
  try {
    return logoutUser(token);
  } catch (err) {
    Logger.log('api_logout error: ' + err.stack);
    return errResult('ออกจากระบบไม่สำเร็จ: ' + err.message);
  }
}

/**
 * api_getCurrentUser(token) — ดึงข้อมูล user ปัจจุบัน
 */
function api_getCurrentUser(token) {
  try {
    return getCurrentUser(token);
  } catch (err) {
    Logger.log('api_getCurrentUser error: ' + err.stack);
    return errResult('ดึงข้อมูลผู้ใช้ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * api_changePassword(token, oldPassword, newPassword) — เปลี่ยนรหัสผ่าน
 */
function api_changePassword(token, oldPassword, newPassword) {
  try {
    const user = requireAuth_(token);

    if (!oldPassword || !newPassword) {
      return errResult('กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่');
    }
    if (newPassword.length < 6) {
      return errResult('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
    }
    if (oldPassword === newPassword) {
      return errResult('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    }

    // ── ดึง user record + salt/hash ──
    const r = findData(SHEET_NAMES.USERS, 'UserID', user.userId);
    if (!r.success || !r.data) return errResult('ไม่พบบัญชีผู้ใช้');

    // ── ตรวจรหัสเดิม ──
    if (!verifyPassword(oldPassword, r.data.PasswordSalt, r.data.PasswordHash)) {
      writeAuditLogFailed_('UPDATE', 'user', user.userId, 'รหัสผ่านเดิมไม่ถูกต้อง');
      return errResult('รหัสผ่านเดิมไม่ถูกต้อง');
    }

    // ── Hash รหัสใหม่ ──
    const hashResult = hashPassword(newPassword);
    if (!hashResult.success) return hashResult;

    // ── อัปเดต ──
    const upd = updateData(SHEET_NAMES.USERS, 'UserID', user.userId, {
      PasswordHash: hashResult.data.hash,
      PasswordSalt: hashResult.data.salt
    });

    if (upd.success) {
      writeAuditLog('UPDATE', 'user', user.userId, null, 'เปลี่ยนรหัสผ่าน');
    }
    return upd.success
      ? okResult(null, 'เปลี่ยนรหัสผ่านสำเร็จ')
      : errResult(upd.message);
  } catch (err) {
    Logger.log('api_changePassword error: ' + err.stack);
    return errResult('เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + err.message);
  }
}

// ============================================================
// ── PERMISSION CHECK ────────────────────────────────────────
// ============================================================

/**
 * api_checkPermission(token, module, action) — ตรวจสอบสิทธิ์
 */
function api_checkPermission(token, module, action) {
  try {
    const user = requireAuth_(token);
    return checkPermission(user.role, module, action);
  } catch (err) {
    return errResult(err.message);
  }
}

/**
 * api_getPermissionMatrix(token) — ดึง permission matrix ของ role ปัจจุบัน
 * ใช้ฝั่ง client เพื่อ show/hide menu
 */
function api_getPermissionMatrix(token) {
  try {
    const user = requireAuth_(token);
    const matrix = PERMISSION_MATRIX[user.role] || {};
    return okResult({ role: user.role, permissions: matrix }, 'permission matrix');
  } catch (err) {
    return errResult(err.message);
  }
}

// ============================================================
// ── AUDIT LOG (admin) ───────────────────────────────────────
// ============================================================

/**
 * api_getAuditLog(token, limit) — ดึง Audit Log (admin เท่านั้น)
 * @param {string} token
 * @param {number} [limit] - default 200
 */
function api_getAuditLog(token, limit) {
  try {
    requirePermission_(token, 'audit', 'read');
    const result = findAllData(SHEET_NAMES.AUDIT_LOG);
    if (!result.success) return result;
    const max = parseInt(limit) || 200;
    // ── เรียง Timestamp ใหม่สุดก่อน ──
    const sorted = result.data
      .sort((a, b) => String(b.Timestamp).localeCompare(String(a.Timestamp)))
      .slice(0, max)
      .map(r => sanitizeRecord(r));
    return okResult(sorted, 'ดึง Audit Log สำเร็จ');
  } catch (err) {
    return errResult(err.message);
  }
}

// ============================================================
// ── UTILITY ENDPOINTS ──────────────────────────────────────
// ============================================================

/**
 * api_validateCID(cid) — ตรวจสอบเลขบัตรประชาชน (ไม่ต้อง auth)
 */
function api_validateCID(cid) {
  try {
    return validateCID(cid);
  } catch (err) {
    return errResult('ตรวจสอบไม่สำเร็จ: ' + err.message);
  }
}

/**
 * api_formatDate(dateStr, format) — แปลง date เป็น Thai BE
 */
function api_formatDate(dateStr, format) {
  try {
    return okResult({ formatted: formatDateThai(dateStr, format) });
  } catch (err) {
    return errResult('แปลงวันที่ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * api_parseDate(dateText) — แปลง dd/MM/yyyy พ.ศ. → ISO date
 */
function api_parseDate(dateText) {
  try {
    const d = parseThaiDate(dateText);
    if (!d) return errResult('รูปแบบวันที่ไม่ถูกต้อง');
    return okResult({
      iso: d.toISOString(),
      yyyymmdd: formatDateISO(d),
      thai: formatDateThai(d)
    });
  } catch (err) {
    return errResult('แปลงวันที่ไม่สำเร็จ: ' + err.message);
  }
}

/**
 * api_logClientError(payload) — รับ error จาก client → บันทึก Logger
 * ไม่ต้อง auth (เพราะ error อาจเกิดก่อน login)
 */
function api_logClientError(payload) {
  try {
    Logger.log('[CLIENT ERROR] ' + JSON.stringify(payload).substring(0, 1000));
    return okResult(null, 'logged');
  } catch (err) {
    return errResult('Log ไม่สำเร็จ: ' + err.message);
  }
}
