/**
 * ============================================================
 * SheetService.gs - Sheet Operations + Utility Helpers
 * ============================================================
 * ฟังก์ชันจัดการ Google Sheets และ Utility ทั่วไป
 * - CRUD operations (append, update, find)
 * - ID generation
 * - Date formatting (Thai Buddhist Era)
 * - CID masking & validation
 * ============================================================
 */

// ── Cache สำหรับ Sheet object (per-execution) ──
let _SHEET_CACHE_ = {};

/**
 * getSheet(name) — ดึง Sheet object โดยใส่ cache ใน memory
 * @param {string} name - ชื่อ Sheet
 * @returns {Sheet} Google Sheets Sheet object
 * @throws Error ถ้า Sheet ไม่พบ
 */
function getSheet(name) {
  try {
    if (_SHEET_CACHE_[name]) return _SHEET_CACHE_[name];
    const sheet = SpreadsheetApp.getActive().getSheetByName(name);
    if (!sheet) {
      throw new Error('ไม่พบ Sheet: ' + name + ' (กรุณาเรียก setupSheets() ก่อน)');
    }
    _SHEET_CACHE_[name] = sheet;
    return sheet;
  } catch (err) {
    Logger.log('getSheet error: ' + err);
    throw err;
  }
}

/**
 * _getHeaders_(sheet) — อ่าน Header row (cache ใน memory)
 * @private
 */
function _getHeaders_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

/**
 * _readAllAsObjects_(sheet) — อ่านข้อมูลทั้งหมดเป็น Array of Object
 * พร้อม __rowIndex (1-based, รวม header) สำหรับ update ภายหลัง
 * @private
 */
function _readAllAsObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map((row, i) => {
    const obj = { __rowIndex: i + 2 }; // +2 = header(1) + 1-based
    headers.forEach((h, j) => obj[h] = row[j]);
    return obj;
  });
}

/**
 * appendData(sheetName, data) — เพิ่มแถวข้อมูลใหม่
 * Auto-fill: CreatedAt, generate ID ถ้าไม่มี
 * @param {string} sheetName
 * @param {Object} data - ข้อมูลในรูป {ColumnName: value}
 * @returns {Object} {success, data: {id, rowIndex}, message}
 */
function appendData(sheetName, data) {
  try {
    if (!sheetName || !data || typeof data !== 'object') {
      return { success: false, data: null, message: 'พารามิเตอร์ไม่ถูกต้อง' };
    }
    const sheet = getSheet(sheetName);
    const headers = _getHeaders_(sheet);
    if (!headers.length) {
      return { success: false, data: null, message: 'Sheet ไม่มี header: ' + sheetName };
    }

    // ── Auto-fill timestamps ──
    if (headers.includes('CreatedAt') && !data.CreatedAt) {
      data.CreatedAt = new Date().toISOString();
    }

    // ── สร้าง row ตามลำดับ header ──
    const row = headers.map(h => {
      let v = data[h];
      if (v === undefined || v === null) return '';
      // ── Apostrophe prefix สำหรับ text columns ──
      if (TEXT_COLUMNS.includes(h) && v !== '' && !String(v).startsWith("'")) {
        return "'" + String(v);
      }
      // ── Date → ISO string ──
      if (v instanceof Date) return v.toISOString();
      return v;
    });

    sheet.appendRow(row);
    const lastRow = sheet.getLastRow();

    // ── หา primary key column (column แรกที่ลงท้ายด้วย ID) ──
    const pkCol = headers.find(h => h.endsWith('ID') || h === 'SettingKey');
    const id = pkCol ? data[pkCol] : null;

    return { success: true, data: { id, rowIndex: lastRow }, message: 'เพิ่มข้อมูลสำเร็จ' };
  } catch (err) {
    Logger.log('appendData error [' + sheetName + ']: ' + err.stack);
    return { success: false, data: null, message: 'เพิ่มข้อมูลไม่สำเร็จ: ' + err.message };
  }
}

/**
 * updateData(sheetName, keyColumn, keyValue, data) — อัปเดตข้อมูล
 * @param {string} sheetName
 * @param {string} keyColumn - คอลัมน์ที่ใช้หา (เช่น 'PatientID')
 * @param {string} keyValue - ค่าที่จะหา
 * @param {Object} data - ข้อมูลที่จะอัปเดต {ColumnName: value}
 * @returns {Object} {success, data: {rowIndex, updatedFields}, message}
 */
function updateData(sheetName, keyColumn, keyValue, data) {
  try {
    if (!sheetName || !keyColumn || keyValue === undefined || keyValue === null) {
      return { success: false, data: null, message: 'พารามิเตอร์ไม่ถูกต้อง' };
    }
    const sheet = getSheet(sheetName);
    const headers = _getHeaders_(sheet);
    const keyIdx = headers.indexOf(keyColumn);
    if (keyIdx < 0) {
      return { success: false, data: null, message: 'ไม่พบคอลัมน์: ' + keyColumn };
    }

    // ── Auto-fill UpdatedAt ──
    if (headers.includes('UpdatedAt')) {
      data.UpdatedAt = new Date().toISOString();
    }

    // ── ค้นหาแถว ──
    const range = sheet.getDataRange();
    const values = range.getValues();
    let targetRow = -1;
    const targetKey = String(keyValue).replace(/^'/, '');

    for (let i = 1; i < values.length; i++) {
      const cellVal = String(values[i][keyIdx]).replace(/^'/, '');
      if (cellVal === targetKey) { targetRow = i + 1; break; }
    }

    if (targetRow < 0) {
      return { success: false, data: null, message: 'ไม่พบข้อมูล ' + keyColumn + '=' + keyValue };
    }

    // ── อัปเดตเฉพาะ field ที่ระบุ ──
    const updatedFields = [];
    Object.entries(data).forEach(([col, val]) => {
      const colIdx = headers.indexOf(col);
      if (colIdx < 0) return;
      let writeVal = val;
      if (val instanceof Date) writeVal = val.toISOString();
      if (TEXT_COLUMNS.includes(col) && val !== '' && val != null && !String(val).startsWith("'")) {
        writeVal = "'" + String(val);
      }
      sheet.getRange(targetRow, colIdx + 1).setValue(writeVal == null ? '' : writeVal);
      updatedFields.push(col);
    });

    return {
      success: true,
      data: { rowIndex: targetRow, updatedFields },
      message: 'อัปเดตข้อมูลสำเร็จ ' + updatedFields.length + ' field'
    };
  } catch (err) {
    Logger.log('updateData error [' + sheetName + ']: ' + err.stack);
    return { success: false, data: null, message: 'อัปเดตไม่สำเร็จ: ' + err.message };
  }
}

/**
 * findData(sheetName, keyColumn, keyValue) — ค้นหาข้อมูล (รายการแรกที่เจอ)
 * @param {string} sheetName
 * @param {string} keyColumn
 * @param {string} keyValue
 * @returns {Object} {success, data: {record} | null, message}
 */
function findData(sheetName, keyColumn, keyValue) {
  try {
    if (!sheetName || !keyColumn || keyValue === undefined || keyValue === null) {
      return { success: false, data: null, message: 'พารามิเตอร์ไม่ถูกต้อง' };
    }
    const sheet = getSheet(sheetName);
    const all = _readAllAsObjects_(sheet);
    const targetKey = String(keyValue).replace(/^'/, '');
    const found = all.find(r => String(r[keyColumn]).replace(/^'/, '') === targetKey);
    if (!found) {
      return { success: true, data: null, message: 'ไม่พบข้อมูล' };
    }
    return { success: true, data: found, message: 'พบข้อมูล' };
  } catch (err) {
    Logger.log('findData error [' + sheetName + ']: ' + err.stack);
    return { success: false, data: null, message: 'ค้นหาไม่สำเร็จ: ' + err.message };
  }
}

/**
 * findAllData(sheetName, filterFn?) — ดึงข้อมูลทั้งหมด (optional filter)
 * @param {string} sheetName
 * @param {Function} [filterFn] - (record) => boolean
 * @returns {Object} {success, data: [...], message}
 */
function findAllData(sheetName, filterFn) {
  try {
    const sheet = getSheet(sheetName);
    let all = _readAllAsObjects_(sheet);
    if (typeof filterFn === 'function') all = all.filter(filterFn);
    return { success: true, data: all, message: 'พบ ' + all.length + ' รายการ' };
  } catch (err) {
    Logger.log('findAllData error: ' + err.stack);
    return { success: false, data: null, message: 'ดึงข้อมูลไม่สำเร็จ: ' + err.message };
  }
}

/**
 * deleteData(sheetName, keyColumn, keyValue) — Soft delete (set IsActive=false)
 * ถ้า sheet ไม่มี IsActive จะ hard delete row
 */
function deleteData(sheetName, keyColumn, keyValue) {
  try {
    const sheet = getSheet(sheetName);
    const headers = _getHeaders_(sheet);
    if (headers.includes('IsActive')) {
      return updateData(sheetName, keyColumn, keyValue, { IsActive: false });
    }
    // Hard delete
    const range = sheet.getDataRange();
    const values = range.getValues();
    const keyIdx = headers.indexOf(keyColumn);
    if (keyIdx < 0) return { success: false, data: null, message: 'ไม่พบคอลัมน์: ' + keyColumn };
    const targetKey = String(keyValue).replace(/^'/, '');
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][keyIdx]).replace(/^'/, '') === targetKey) {
        sheet.deleteRow(i + 1);
        return { success: true, data: { rowIndex: i + 1 }, message: 'ลบข้อมูลสำเร็จ' };
      }
    }
    return { success: false, data: null, message: 'ไม่พบข้อมูล' };
  } catch (err) {
    Logger.log('deleteData error: ' + err.stack);
    return { success: false, data: null, message: 'ลบไม่สำเร็จ: ' + err.message };
  }
}

// ============================================================
// ── ID GENERATION ────────────────────────────────────────────
// ============================================================

/**
 * generateId(prefix) — สร้าง Primary Key แบบ unique
 * รูปแบบ: PREFIX + Date.now() + random4
 * เช่น PT17196001234567
 * @param {string} prefix - คำนำหน้า (PT, USR, VT, ...)
 * @returns {string}
 */
function generateId(prefix) {
  try {
    if (!prefix) prefix = 'ID';
    const timestamp = Date.now();
    const random = Math.floor(1000 + Math.random() * 9000); // 4 หลัก
    return String(prefix).toUpperCase() + timestamp + random;
  } catch (err) {
    Logger.log('generateId error: ' + err);
    return 'ID' + Date.now();
  }
}

// ============================================================
// ── DATE FORMATTING (Thai Buddhist Era) ─────────────────────
// ============================================================

const THAI_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                            'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const THAI_MONTHS_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                           'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

/**
 * formatDateThai(date, format?) — แปลง Date → "dd/MM/yyyy พ.ศ."
 * @param {Date|string} date
 * @param {string} [format] - 'short' (default: 28/06/2569) | 'long' (28 มิถุนายน 2569) | 'shortmonth' (28 มิ.ย. 2569)
 * @returns {string}
 */
function formatDateThai(date, format) {
  try {
    if (!date) return '-';
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return String(date);

    const day = String(d.getDate()).padStart(2, '0');
    const monthIdx = d.getMonth();
    const yearBE = d.getFullYear() + 543;

    if (format === 'long') {
      return d.getDate() + ' ' + THAI_MONTHS_FULL[monthIdx] + ' ' + yearBE;
    }
    if (format === 'shortmonth') {
      return d.getDate() + ' ' + THAI_MONTHS_SHORT[monthIdx] + ' ' + yearBE;
    }
    return day + '/' + String(monthIdx + 1).padStart(2, '0') + '/' + yearBE;
  } catch (err) {
    Logger.log('formatDateThai error: ' + err);
    return String(date);
  }
}

/**
 * parseThaiDate(dateText) — แปลง "dd/MM/yyyy พ.ศ." → Date object (ค.ศ.)
 * รับได้ทั้ง พ.ศ. และ ค.ศ. (ถ้าปี > 2400 ถือเป็น พ.ศ.)
 * @param {string} dateText - "28/06/2569" หรือ "28/06/2026"
 * @returns {Date|null}
 */
function parseThaiDate(dateText) {
  try {
    if (!dateText) return null;
    if (dateText instanceof Date) return dateText;

    const s = String(dateText).trim();

    // ลอง parse ISO ก่อน
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }

    // dd/MM/yyyy หรือ dd-MM-yyyy
    const parts = s.split(/[\/\-]/);
    if (parts.length !== 3) return null;

    let day = parseInt(parts[0], 10);
    let month = parseInt(parts[1], 10);
    let year = parseInt(parts[2], 10);

    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    if (year > 2400) year -= 543; // พ.ศ. → ค.ศ.

    const d = new Date(year, month - 1, day);
    return isNaN(d.getTime()) ? null : d;
  } catch (err) {
    Logger.log('parseThaiDate error: ' + err);
    return null;
  }
}

/**
 * formatDateISO(date) — แปลง Date → "yyyy-MM-dd" (สำหรับเก็บใน Sheet)
 */
function formatDateISO(date) {
  try {
    if (!date) return '';
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  } catch (err) {
    return '';
  }
}

// ============================================================
// ── CID HANDLING ─────────────────────────────────────────────
// ============================================================

/**
 * maskCID(cid) — ปิดบังเลขบัตรประชาชน
 * แสดงรูปแบบ "X-XXXX-XXXXX-XX-{last1}" — เห็นเฉพาะตัวสุดท้าย
 * @param {string} cid - เลข 13 หลัก
 * @returns {string} เช่น "X-XXXX-XXXXX-XX-3"
 */
function maskCID(cid) {
  try {
    if (!cid) return '-';
    const s = String(cid).replace(/\D/g, '');
    if (s.length !== 13) return '***ไม่ถูกต้อง***';
    return 'X-XXXX-XXXXX-XX-' + s.slice(-1);
  } catch (err) {
    return '***masked***';
  }
}

/**
 * maskCIDPartial(cid) — แสดง 4 ตัวท้าย (สำหรับ admin บางหน้า)
 * รูปแบบ "*********{last4}"
 */
function maskCIDPartial(cid) {
  try {
    if (!cid) return '-';
    const s = String(cid).replace(/\D/g, '');
    if (s.length !== 13) return '***';
    return '*********' + s.slice(-4);
  } catch (err) {
    return '***';
  }
}

/**
 * validateCID(cid) — ตรวจสอบเลขบัตรประชาชน 13 หลัก (Checksum)
 * อ้างอิงสูตรของกรมการปกครอง: ผลรวม * weight (13..2) % 11 → (11 - mod) % 10 = หลักสุดท้าย
 * @param {string} cid
 * @returns {Object} {success, data: {valid: boolean}, message}
 */
function validateCID(cid) {
  try {
    if (!cid) {
      return { success: false, data: { valid: false }, message: 'กรุณากรอกเลขบัตรประชาชน' };
    }
    const s = String(cid).replace(/\D/g, '');
    if (s.length !== 13) {
      return { success: false, data: { valid: false }, message: 'เลขบัตรประชาชนต้องมี 13 หลัก' };
    }
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(s.charAt(i), 10) * (13 - i);
    }
    const checkDigit = (11 - (sum % 11)) % 10;
    const valid = checkDigit === parseInt(s.charAt(12), 10);
    return {
      success: true,
      data: { valid },
      message: valid ? 'เลขบัตรประชาชนถูกต้อง' : 'เลขบัตรประชาชนไม่ถูกต้อง (checksum ผิด)'
    };
  } catch (err) {
    Logger.log('validateCID error: ' + err);
    return { success: false, data: { valid: false }, message: 'ตรวจสอบไม่สำเร็จ: ' + err.message };
  }
}

// ============================================================
// ── COMMON UTILITY ──────────────────────────────────────────
// ============================================================

/**
 * sanitizeRecord(record, excludeFields?) — ลบ field ที่ไม่ควรส่งให้ client
 * เช่น PasswordHash, PasswordSalt, __rowIndex
 * แปลง Date → ISO string
 * Mask CID เสมอ
 */
function sanitizeRecord(record, excludeFields) {
  try {
    if (!record) return record;
    const exclude = ['__rowIndex','PasswordHash','PasswordSalt'].concat(excludeFields || []);
    const out = {};
    Object.entries(record).forEach(([k, v]) => {
      if (exclude.includes(k)) return;
      if (v instanceof Date) { out[k] = v.toISOString(); return; }
      if (k === 'CID' && v) { out[k] = maskCID(v); out['CIDMasked'] = maskCID(v); return; }
      out[k] = v;
    });
    return out;
  } catch (err) {
    return record;
  }
}

/**
 * okResult(data, message) — helper สร้าง success response
 */
function okResult(data, message) {
  return { success: true, data: data == null ? null : data, message: message || 'สำเร็จ' };
}

/**
 * errResult(message, data) — helper สร้าง error response
 */
function errResult(message, data) {
  return { success: false, data: data == null ? null : data, message: message || 'เกิดข้อผิดพลาด' };
}
