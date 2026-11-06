// Test cho parse.mjs (chạy: npm test, trong thư mục test-ocr/hsd-js). Dùng node:test có sẵn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpiry, parseTruth, isRealDate } from './parse.mjs';

test('nhãn HSD đứng trước ngày', () => {
  assert.equal(parseExpiry('HSD: 280920'), '2020-09-28');
  assert.equal(parseExpiry('hsd:11.01.24 13:45:30'), '2024-01-11');
  assert.equal(parseExpiry('Hạn sử dụng: 01/12/2024'), '2024-12-01');
  assert.equal(parseExpiry('Han su dung 01-12-24'), '2024-12-01');
  assert.equal(parseExpiry('HSD / EXP: 011224 T41 02'), '2024-12-01');
  assert.equal(parseExpiry('BB 05.10.21'), '2021-10-05');
  assert.equal(parseExpiry('best before : 05 / Oct / 2021'), '2021-10-05');
});

test('nhãn HSD được ưu tiên hơn ngày không nhãn muộn hơn', () => {
  assert.equal(parseExpiry('31.12.29 EXP 01.01.25'), '2025-01-01');
});

test('ngày có dấu / . - (cho phép khoảng trắng quanh dấu, năm 2 hoặc 4 số)', () => {
  assert.equal(parseExpiry('19/09/20'), '2020-09-19');
  assert.equal(parseExpiry('19.09.20'), '2020-09-19');
  assert.equal(parseExpiry('19-09-2020'), '2020-09-19');
  assert.equal(parseExpiry('19 . 09 . 20'), '2020-09-19');
  assert.equal(parseExpiry('abc 1/9/2020 xyz'), '2020-09-01');
});

test('6 số liền ddmmyy', () => {
  assert.equal(parseExpiry('131126 32 I'), '2026-11-13');
  assert.equal(parseExpiry('071026'), '2026-10-07');
  // dãy 7 số không cắt ra 6 số
  assert.equal(parseExpiry('0710261'), '');
});

test('tháng viết tắt tiếng Anh', () => {
  assert.equal(parseExpiry('05 / Oct / 2021'), '2021-10-05');
  assert.equal(parseExpiry('05 OCT 21'), '2021-10-05');
  assert.equal(parseExpiry('05-Sept-2021'), '2021-09-05');
});

test('30/02 bị bỏ', () => {
  assert.equal(parseExpiry('30/02/2024'), '');
  assert.equal(parseExpiry('300224'), '');
});

test('29/02/2024 nhận (năm nhuận), 29/02/2023 bỏ', () => {
  assert.equal(parseExpiry('29/02/2024'), '2024-02-29');
  assert.equal(parseExpiry('290224'), '2024-02-29');
  assert.equal(parseExpiry('29/02/2023'), '');
  assert.equal(parseExpiry('290223'), '');
});

test('tháng 13 bị bỏ', () => {
  assert.equal(parseExpiry('01/13/2024'), '');
  assert.equal(parseExpiry('011324'), '');
});

test('ứng viên đầu sai lịch thì lấy ứng viên kế tiếp', () => {
  // nhãn HSD đi với ngày sai lịch → không còn ứng viên mức 1 → xét mức 2
  assert.equal(parseExpiry('HSD: 30/02/25, 01.03.24'), '2024-03-01');
  // cùng mức 3: 310424 sai lịch (tháng 4 có 30 ngày), lấy 150324
  assert.equal(parseExpiry('310424 150324'), '2024-03-15');
});

test('NSX và HSD cùng dòng có nhãn thì lấy HSD', () => {
  assert.equal(parseExpiry('NSX:12.05.23 HSD:11.01.24'), '2024-01-11');
  // NSX muộn hơn (OCR đọc sai) vẫn không được lấy, vì ngày sau nhãn NSX bị bỏ
  assert.equal(parseExpiry('NSX: 010425 HSD: 010424'), '2024-04-01');
  assert.equal(parseExpiry('MFG 01/02/2024 EXP 01/02/2025'), '2025-02-01');
  assert.equal(parseExpiry('Ngày sản xuất: 01/02/2024 Hạn sử dụng: 01/08/2024'), '2024-08-01');
});

test('ngày ngay sau nhãn NSX bị bỏ kể cả khi không còn ngày nào khác', () => {
  assert.equal(parseExpiry('NSX:200323'), '');
  assert.equal(parseExpiry('Ngày SX 20.03.23'), '');
});

test('2 ngày không nhãn thì lấy ngày muộn hơn', () => {
  assert.equal(parseExpiry('200923 B1 01\n200323 08:33'), '2023-09-20');
  assert.equal(parseExpiry('020624 08:18 011224 T41'), '2024-12-01');
  assert.equal(parseExpiry('12.05.23 11.01.24'), '2024-01-11');
});

test('năm ngoài 2000–2100 bị bỏ', () => {
  assert.equal(parseExpiry('01/01/1999'), '');
  assert.equal(parseExpiry('01/01/2101'), '');
  assert.equal(parseExpiry('01/01/2100'), '2100-01-01');
  assert.equal(parseExpiry('01/01/1999 01/01/2000'), '2000-01-01');
});

test('không có ngày thì trả chuỗi rỗng', () => {
  assert.equal(parseExpiry(''), '');
  assert.equal(parseExpiry('HSD:'), '');
  assert.equal(parseExpiry('13:45:30'), '');
  assert.equal(parseExpiry(undefined), '');
});

test('isRealDate kiểm lịch thật', () => {
  assert.equal(isRealDate(31, 12, 2024), true);
  assert.equal(isRealDate(31, 4, 2024), false);
  assert.equal(isRealDate(29, 2, 2000), true); // 2000 chia hết 400: nhuận
  assert.equal(isRealDate(29, 2, 2100), false); // 2100 chia hết 100, không chia hết 400
  assert.equal(isRealDate(0, 1, 2024), false);
  assert.equal(isRealDate(1.5, 1, 2024), false);
});

test('parseTruth đọc đủ 3 dạng của 9 ô han_su_dung', () => {
  const cells = {
    '280920': '2020-09-28',
    '11.01.24': '2024-01-11',
    '131126': '2026-11-13',
    '010424': '2024-04-01',
    '19.09.20': '2020-09-19',
    '071026': '2026-10-07',
    '011224': '2024-12-01',
    '05 / Oct / 2021': '2021-10-05',
    '200923': '2023-09-20',
  };
  for (const [cell, iso] of Object.entries(cells)) assert.equal(parseTruth(cell), iso, cell);
  assert.equal(parseTruth(''), '');
  assert.equal(parseTruth('300224'), '');
  assert.equal(parseTruth('HSD 280920'), '');
});
