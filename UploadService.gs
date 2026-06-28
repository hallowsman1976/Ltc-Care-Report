/**
 * ============================================================
 * UploadService.gs - Photo Attachment (Google Drive)
 * ============================================================
 * - อัปโหลดรูปภาพการเยี่ยมเก็บใน Google Drive
 * - โฟลเดอร์จาก Setting: DRIVE_FOLDER_LTC_PHOTO (สร้างให้อัตโนมัติถ้าว่าง)
 * - จำกัดชนิดไฟล์ jpg / png / webp
 * - ต้องมี PDPA consent ก่อนอัปโหลด
 * - บันทึก URL ใน Photos sheet
 * - Audit Log ทุก upload / delete
 * ============================================================
 */

const ALLOWED_PHOTO_MIME = ['image/jpeg','image/jpg','image/png','image/webp'];
const PHOTO_FOLDER_CACHE_KEY = 'ltc_photo_root_folder';

/**
 * _getPhotoRootFolder_() — คืน Folder object สำหรับเก็บรูป (สร้างถ้าไม่มี)
 * อ่าน id จาก Setting DRIVE_FOLDER_LTC_PHOTO; ถ้าว่างหรือเข้าไม่ได้ → สร้างใหม่ + เซฟ id
 * @private
 */
function _getPhotoRootFolder_() {
  // ลอง cache ก่อน
  const cached = CacheService.getScriptCache().get(PHOTO_FOLDER_CACHE_KEY);
  if (cached) {
    try { return DriveApp.getFolderById(cached); } catch (e) {}
  }

  let folderId = getSettingValue_('DRIVE_FOLDER_LTC_PHOTO');
  let folder = null;
  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); } catch (e) { folder = null; }
  }
  if (!folder) {
    // สร้างใหม่
    folder = DriveApp.createFolder('LTC_Photos_' + new Date().getFullYear());
    folderId = folder.getId();
    setSettingValue_('DRIVE_FOLDER_LTC_PHOTO', folderId, null);
  }
  CacheService.getScriptCache().put(PHOTO_FOLDER_CACHE_KEY, folderId, 21600); // 6 ชม.
  return folder;
}

/**
 * _getPatientPhotoFolder_(rootFolder, patientId) — โฟลเดอร์ย่อยต่อผู้ป่วย
 * @private
 */
function _getPatientPhotoFolder_(rootFolder, patientId) {
  const name = 'P_' + patientId;
  const it = rootFolder.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return rootFolder.createFolder(name);
}

/**
 * _verifyVisitAccess_(visitId, user) — ตรวจสิทธิ์เข้าถึง visit → คืน {visit, patient}
 * @private
 */
function _verifyVisitAccess_(visitId, user) {
  const v = findData(SHEET_NAMES.VISITS, 'VisitID', visitId);
  if (!v.success || !v.data) throw new Error('ไม่พบ Visit: ' + visitId);
  const p = findData(SHEET_NAMES.PATIENTS, 'PatientID', v.data.PatientID);
  if (!p.success || !p.data) throw new Error('ไม่พบผู้ป่วย');
  if (user.role === 'admin' || user.role === 'viewer') return { visit:v.data, patient:p.data };
  if (user.role === 'cm' && p.data.CareManagerID === user.userId) return { visit:v.data, patient:p.data };
  if (user.role === 'cg' && p.data.CaregiverID === user.userId) return { visit:v.data, patient:p.data };
  throw new Error('ไม่มีสิทธิ์เข้าถึง Visit ของผู้ป่วยรายนี้');
}

/**
 * uploadPhoto(base64, filename, patientId, visitId, caption, consent) — อัปโหลดรูป
 * @returns {Object} {success, data: {photoId, url, thumbnailUrl}, message}
 */
function uploadPhoto(base64, filename, patientId, visitId, caption, consent) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'photo', 'create');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์อัปโหลดรูปภาพ');

    // ── PDPA consent ──
    if (consent !== true && consent !== 'true') {
      return errResult('กรุณายืนยันการให้ความยินยอม (PDPA) ก่อนอัปโหลดรูปภาพ');
    }

    if (!base64) return errResult('ไม่มีข้อมูลรูปภาพ');
    if (!visitId) return errResult('ต้องระบุ VisitID');

    // ── ตรวจสิทธิ์ visit ──
    const { visit } = _verifyVisitAccess_(visitId, user);
    const pid = patientId || visit.PatientID;

    // ── แยก data URI + ตรวจ mime ──
    let raw = String(base64);
    let mime = '';
    const m = raw.match(/^data:([^;]+);base64,(.*)$/);
    if (m) { mime = m[1].toLowerCase(); raw = m[2]; }
    if (!mime) {
      // เดาจากนามสกุล
      const ext = String(filename||'').toLowerCase().split('.').pop();
      mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    }
    if (ALLOWED_PHOTO_MIME.indexOf(mime) < 0) {
      return errResult('รองรับเฉพาะไฟล์ jpg, png, webp เท่านั้น (ได้รับ: ' + mime + ')');
    }

    // ── decode + สร้างไฟล์ใน Drive ──
    const bytes = Utilities.base64Decode(raw);
    const safeName = (filename || ('photo_' + Date.now()))
      .replace(/[^\w.\-ก-๙ ]/g, '_');
    const blob = Utilities.newBlob(bytes, mime, safeName);

    const root = _getPhotoRootFolder_();
    const folder = _getPatientPhotoFolder_(root, pid);
    const file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

    const fileId = file.getId();
    const url = 'https://drive.google.com/uc?export=view&id=' + fileId;
    const thumb = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';

    // ── บันทึก Photos sheet ──
    const photoId = generateId('PHO');
    const now = new Date().toISOString();
    const rec = {
      PhotoID: photoId, PatientID: pid, VisitID: visitId,
      DriveFileID: fileId, DriveURL: url, ThumbnailURL: thumb,
      FileName: safeName, FileSize: bytes.length, MimeType: mime,
      Caption: caption || '', PhotoCategory: 'visit',
      UploadedBy: user.userId, UploadedDate: formatDateISO(new Date()),
      IsActive: true, CreatedAt: now
    };
    const r = appendData(SHEET_NAMES.PHOTOS, rec);
    if (!r.success) return r;

    writeAuditLog('UPLOAD', 'photo', photoId, null,
      { patientId: pid, visitId, fileName: safeName, size: bytes.length });

    return okResult({ photoId, url, thumbnailUrl: thumb, fileId }, 'อัปโหลดรูปภาพสำเร็จ');
  } catch (err) {
    Logger.log('uploadPhoto error: ' + err.stack);
    writeAuditLogFailed_('UPLOAD', 'photo', '', err.message);
    return errResult('อัปโหลดไม่สำเร็จ: ' + err.message);
  }
}

/**
 * getPhotosByVisit(visitId) — ดึงรูปทั้งหมดของ visit (ที่ยัง active)
 */
function getPhotosByVisit(visitId) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'photo', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูรูปภาพ');
    if (!visitId) return errResult('ต้องระบุ VisitID');

    _verifyVisitAccess_(visitId, user);

    const r = findAllData(SHEET_NAMES.PHOTOS, x =>
      x.VisitID === visitId && (x.IsActive === true || String(x.IsActive) === 'true' || String(x.IsActive) === 'TRUE')
    );
    if (!r.success) return r;
    const data = (r.data || []).map(p => { delete p.__rowIndex; return p; });
    return okResult(data, 'พบ ' + data.length + ' รูป');
  } catch (err) {
    Logger.log('getPhotosByVisit error: ' + err.stack);
    return errResult(err.message);
  }
}

/**
 * getPhotosByPatient(patientId) — ดึงรูปทั้งหมดของผู้ป่วย (bonus)
 */
function getPhotosByPatient(patientId) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'photo', 'read');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ดูรูปภาพ');
    if (!patientId) return errResult('ต้องระบุ PatientID');

    const r = findAllData(SHEET_NAMES.PHOTOS, x =>
      x.PatientID === patientId && (x.IsActive === true || String(x.IsActive) === 'true' || String(x.IsActive) === 'TRUE')
    );
    if (!r.success) return r;
    const data = (r.data || [])
      .sort((a,b) => String(b.CreatedAt||'').localeCompare(String(a.CreatedAt||'')))
      .map(p => { delete p.__rowIndex; return p; });
    return okResult(data, 'พบ ' + data.length + ' รูป');
  } catch (err) {
    return errResult(err.message);
  }
}

/**
 * deletePhoto(photoId) — ลบรูป (trash ไฟล์ Drive + soft delete sheet)
 */
function deletePhoto(photoId) {
  try {
    const user = requireAuth_();
    const check = checkPermission(user.role, 'photo', 'delete');
    if (!check.data.allowed) return errResult('ไม่มีสิทธิ์ลบรูปภาพ');
    if (!photoId) return errResult('ต้องระบุ PhotoID');

    const r = findData(SHEET_NAMES.PHOTOS, 'PhotoID', photoId);
    if (!r.success || !r.data) return errResult('ไม่พบรูปภาพ');

    // ── ตรวจสิทธิ์ผ่าน visit ──
    try { _verifyVisitAccess_(r.data.VisitID, user); } catch (e) {
      if (user.role !== 'admin') return errResult(e.message);
    }

    // ── trash ไฟล์ใน Drive ──
    if (r.data.DriveFileID) {
      try { DriveApp.getFileById(r.data.DriveFileID).setTrashed(true); } catch (e) {}
    }

    const upd = updateData(SHEET_NAMES.PHOTOS, 'PhotoID', photoId, { IsActive: false });
    if (!upd.success) return upd;

    writeAuditLog('DELETE', 'photo', photoId, { fileName: r.data.FileName }, { trashed: true });
    return okResult(null, 'ลบรูปภาพสำเร็จ');
  } catch (err) {
    Logger.log('deletePhoto error: ' + err.stack);
    writeAuditLogFailed_('DELETE', 'photo', photoId, err.message);
    return errResult('ลบไม่สำเร็จ: ' + err.message);
  }
}

// ============================================================
// ── API WRAPPERS ────────────────────────────────────────────
// ============================================================

function api_uploadPhoto(token, base64, filename, patientId, visitId, caption, consent) {
  _CURRENT_TOKEN_ = token;
  try { return uploadPhoto(base64, filename, patientId, visitId, caption, consent); }
  catch (err) { return errResult(err.message); }
}
function api_getPhotosByVisit(token, visitId) {
  _CURRENT_TOKEN_ = token;
  try { return getPhotosByVisit(visitId); }
  catch (err) { return errResult(err.message); }
}
function api_getPhotosByPatient(token, patientId) {
  _CURRENT_TOKEN_ = token;
  try { return getPhotosByPatient(patientId); }
  catch (err) { return errResult(err.message); }
}
function api_deletePhoto(token, photoId) {
  _CURRENT_TOKEN_ = token;
  try { return deletePhoto(photoId); }
  catch (err) { return errResult(err.message); }
}
