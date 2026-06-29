/**
 * ============================================================
 * ImportService.gs — นำเข้าข้อมูลแบบกลุ่ม (CSV) [admin/cm]
 * ============================================================
 * - importPatients   : เพิ่มผู้สูงอายุหลายรายจากตาราง (reuse savePatient)
 * - importCaregivers : เพิ่มผู้ดูแล (CG) หลายราย (reuse createUser, role=cg)
 *
 * Frontend แปลง CSV → array ของ object (field ตรง schema) แล้วส่งมาทาง RPC
 * คืนสรุป { total, created, failed, errors:[{row, name/username, message}] }
 * ============================================================
 */

/**
 * api_importPatients(token, items) — นำเข้าผู้สูงอายุ
 * @param {Object[]} items - แต่ละ item = { FullName, Sex, BirthDate, CID, ... }
 */
function api_importPatients(token, items) {
  _CURRENT_TOKEN_ = token;
  try {
    requirePermission_(token, 'patient', 'create');
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) return errResult('ไม่มีข้อมูลให้นำเข้า');
    if (rows.length > 500) return errResult('นำเข้าได้ครั้งละไม่เกิน 500 รายการ');

    let created = 0;
    const errors = [];
    rows.forEach((row, i) => {
      try {
        const r = savePatient(row || {});
        if (r.success) created++;
        else errors.push({ row: i + 1, name: (row && row.FullName) || '', message: r.message });
      } catch (e) {
        errors.push({ row: i + 1, name: (row && row.FullName) || '', message: e.message });
      }
    });

    writeAuditLog('CREATE', 'patient', 'import', null, { imported: created, failed: errors.length });
    return okResult(
      { total: rows.length, created, failed: errors.length, errors: errors.slice(0, 50) },
      'นำเข้าผู้สูงอายุ: สำเร็จ ' + created + ' / ' + rows.length + ' รายการ'
    );
  } catch (err) {
    Logger.log('api_importPatients error: ' + err.stack);
    return errResult(err.message);
  }
}

/**
 * api_importCaregivers(token, items) — นำเข้าผู้ดูแล (CG)
 * @param {Object[]} items - แต่ละ item = { username, password, fullName, nickName, phone, email }
 */
function api_importCaregivers(token, items) {
  _CURRENT_TOKEN_ = token;
  try {
    const user = requirePermission_(token, 'user', 'create');
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) return errResult('ไม่มีข้อมูลให้นำเข้า');
    if (rows.length > 300) return errResult('นำเข้าได้ครั้งละไม่เกิน 300 รายการ');

    let created = 0;
    const errors = [];
    rows.forEach((row, i) => {
      row = row || {};
      try {
        const r = createUser({
          username: row.username, password: row.password, fullName: row.fullName,
          nickName: row.nickName || '', role: 'cg',
          phone: row.phone || '', email: row.email || ''
        }, user.userId);
        if (r.success) created++;
        else errors.push({ row: i + 1, username: row.username || '', message: r.message });
      } catch (e) {
        errors.push({ row: i + 1, username: row.username || '', message: e.message });
      }
    });

    return okResult(
      { total: rows.length, created, failed: errors.length, errors: errors.slice(0, 50) },
      'นำเข้าผู้ดูแล (CG): สำเร็จ ' + created + ' / ' + rows.length + ' รายการ'
    );
  } catch (err) {
    Logger.log('api_importCaregivers error: ' + err.stack);
    return errResult(err.message);
  }
}
