/**
 * ============================================================
 * UserService.gs — จัดการผู้ใช้ระบบ (admin เท่านั้น)
 * ============================================================
 * - getUsers      : รายชื่อผู้ใช้ (ไม่คืน hash/salt)
 * - createUser    : เพิ่มผู้ใช้ใหม่ (CG/CM/viewer/admin)
 * - updateUser    : แก้ไขข้อมูล + รีเซ็ตรหัสผ่าน (option)
 * - setUserActive : เปิด/ปิดบัญชี
 *
 * Users schema: UserID, Username, PasswordHash, PasswordSalt, FullName,
 *   NickName, Role, Phone, Email, OrgName, IsActive, CreatedAt, UpdatedAt,
 *   LastLoginAt, CreatedBy
 * ============================================================
 */

const VALID_ROLES = ['admin', 'cm', 'cg', 'viewer'];

/**
 * _sanitizeUser_(u) — ตัด field sensitive ออกก่อนส่งให้ client
 * @private
 */
function _sanitizeUser_(u) {
  return {
    UserID: u.UserID, Username: u.Username, FullName: u.FullName,
    NickName: u.NickName || '', Role: u.Role, Phone: u.Phone || '',
    Email: u.Email || '', OrgName: u.OrgName || '',
    IsActive: u.IsActive === true || u.IsActive === 'true' || u.IsActive === 'TRUE',
    CreatedAt: u.CreatedAt || '', LastLoginAt: u.LastLoginAt || ''
  };
}

/**
 * getUsers(roleFilter?) — รายชื่อผู้ใช้ทั้งหมด (option กรองตาม role)
 */
function getUsers(roleFilter) {
  const r = findAllData(SHEET_NAMES.USERS);
  if (!r.success) return r;
  let list = (r.data || []).map(_sanitizeUser_);
  if (roleFilter) list = list.filter(u => u.Role === roleFilter);
  // เรียงตามชื่อ
  list.sort((a, b) => String(a.FullName || '').localeCompare(String(b.FullName || ''), 'th'));
  return okResult(list, 'รายชื่อผู้ใช้ ' + list.length + ' คน');
}

/**
 * createUser(data, createdBy) — เพิ่มผู้ใช้ใหม่
 * @param {Object} data {username, password, fullName, nickName, role, phone, email, orgName}
 */
function createUser(data, createdBy) {
  data = data || {};
  const username = String(data.username || '').trim().toLowerCase();
  const password = String(data.password || '');
  const fullName = String(data.fullName || '').trim();
  const role = String(data.role || '').trim();

  // ── Validate ──
  if (!username || !fullName || !role) {
    return errResult('กรุณากรอกชื่อผู้ใช้ ชื่อ-นามสกุล และบทบาทให้ครบ');
  }
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
    return errResult('ชื่อผู้ใช้ต้องเป็น a-z, 0-9, _ . ความยาว 3–30 ตัว');
  }
  if (!VALID_ROLES.includes(role)) {
    return errResult('บทบาทไม่ถูกต้อง');
  }
  if (password.length < 6) {
    return errResult('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
  }

  // ── ตรวจ username ซ้ำ ──
  const dup = findData(SHEET_NAMES.USERS, 'Username', username);
  if (dup.success && dup.data) {
    return errResult('ชื่อผู้ใช้ "' + username + '" มีอยู่แล้ว');
  }

  // ── Hash + append ──
  const hashResult = hashPassword(password);
  if (!hashResult.success) return hashResult;

  const userId = generateId('USR');
  const now = new Date().toISOString();
  const add = appendData(SHEET_NAMES.USERS, {
    UserID: userId, Username: username,
    PasswordHash: hashResult.data.hash, PasswordSalt: hashResult.data.salt,
    FullName: fullName, NickName: String(data.nickName || '').trim(),
    Role: role, Phone: String(data.phone || '').trim(),
    Email: String(data.email || '').trim(), OrgName: String(data.orgName || '').trim(),
    IsActive: true, CreatedAt: now, UpdatedAt: '', LastLoginAt: '',
    CreatedBy: createdBy || 'SYSTEM'
  });
  if (!add.success) return add;

  writeAuditLog('CREATE', 'user', userId, null, { username, role, fullName });
  return okResult({ userId, username, role }, 'เพิ่มผู้ใช้ "' + fullName + '" สำเร็จ');
}

/**
 * updateUser(userId, data) — แก้ไขผู้ใช้ (+ รีเซ็ตรหัสผ่านถ้าส่ง newPassword)
 */
function updateUser(userId, data) {
  data = data || {};
  if (!userId) return errResult('ไม่ระบุ UserID');

  const cur = findData(SHEET_NAMES.USERS, 'UserID', userId);
  if (!cur.success || !cur.data) return errResult('ไม่พบผู้ใช้');

  const patch = { UpdatedAt: new Date().toISOString() };
  if (data.fullName !== undefined) patch.FullName = String(data.fullName).trim();
  if (data.nickName !== undefined) patch.NickName = String(data.nickName).trim();
  if (data.phone !== undefined)    patch.Phone = String(data.phone).trim();
  if (data.email !== undefined)    patch.Email = String(data.email).trim();
  if (data.orgName !== undefined)  patch.OrgName = String(data.orgName).trim();
  if (data.role !== undefined) {
    if (!VALID_ROLES.includes(data.role)) return errResult('บทบาทไม่ถูกต้อง');
    patch.Role = data.role;
  }

  // ── รีเซ็ตรหัสผ่าน (option) ──
  if (data.newPassword) {
    if (String(data.newPassword).length < 6) return errResult('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
    const h = hashPassword(String(data.newPassword));
    if (!h.success) return h;
    patch.PasswordHash = h.data.hash;
    patch.PasswordSalt = h.data.salt;
  }

  const upd = updateData(SHEET_NAMES.USERS, 'UserID', userId, patch);
  if (!upd.success) return upd;

  writeAuditLog('UPDATE', 'user', userId, null,
    { fields: Object.keys(patch), passwordReset: !!data.newPassword });
  return okResult({ userId }, 'บันทึกการแก้ไขผู้ใช้สำเร็จ');
}

/**
 * setUserActive(userId, active, currentUserId) — เปิด/ปิดบัญชี
 * - ห้ามปิดบัญชีตัวเอง
 * - ห้ามปิด admin คนสุดท้ายที่ยัง active
 */
function setUserActive(userId, active, currentUserId) {
  if (!userId) return errResult('ไม่ระบุ UserID');
  const isActive = active === true || active === 'true';

  const cur = findData(SHEET_NAMES.USERS, 'UserID', userId);
  if (!cur.success || !cur.data) return errResult('ไม่พบผู้ใช้');

  if (!isActive) {
    if (userId === currentUserId) return errResult('ไม่สามารถปิดบัญชีของตัวเองได้');
    // ── กันปิด admin คนสุดท้าย ──
    if (cur.data.Role === 'admin') {
      const all = findAllData(SHEET_NAMES.USERS);
      const activeAdmins = (all.data || []).filter(u =>
        u.Role === 'admin' &&
        (u.IsActive === true || u.IsActive === 'true' || u.IsActive === 'TRUE')
      );
      if (activeAdmins.length <= 1) return errResult('ต้องมีผู้ดูแลระบบ (admin) ที่ใช้งานอยู่อย่างน้อย 1 คน');
    }
  }

  const upd = updateData(SHEET_NAMES.USERS, 'UserID', userId, {
    IsActive: isActive, UpdatedAt: new Date().toISOString()
  });
  if (!upd.success) return upd;

  writeAuditLog('UPDATE', 'user', userId, null, { IsActive: isActive });
  return okResult({ userId, isActive }, isActive ? 'เปิดใช้งานบัญชีแล้ว' : 'ปิดบัญชีแล้ว');
}

// ============================================================
// ── API WRAPPERS (admin) ────────────────────────────────────
// ============================================================

/** api_getUsers(token, roleFilter?) */
function api_getUsers(token, roleFilter) {
  _CURRENT_TOKEN_ = token;
  try {
    requirePermission_(token, 'user', 'read');
    return getUsers(roleFilter);
  } catch (err) { return errResult(err.message); }
}

/** api_createUser(token, data) */
function api_createUser(token, data) {
  _CURRENT_TOKEN_ = token;
  try {
    const user = requirePermission_(token, 'user', 'create');
    return createUser(data, user.userId);
  } catch (err) {
    Logger.log('api_createUser error: ' + err.stack);
    return errResult(err.message);
  }
}

/** api_updateUser(token, userId, data) */
function api_updateUser(token, userId, data) {
  _CURRENT_TOKEN_ = token;
  try {
    requirePermission_(token, 'user', 'update');
    return updateUser(userId, data);
  } catch (err) {
    Logger.log('api_updateUser error: ' + err.stack);
    return errResult(err.message);
  }
}

/** api_setUserActive(token, userId, active) */
function api_setUserActive(token, userId, active) {
  _CURRENT_TOKEN_ = token;
  try {
    const user = requirePermission_(token, 'user', 'update');
    return setUserActive(userId, active, user.userId);
  } catch (err) { return errResult(err.message); }
}
