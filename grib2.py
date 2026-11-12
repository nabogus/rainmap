"""ตัวถอด GRIB2 แบบเล็ก สำหรับไฟล์ APCP ของ GFS จาก NOMADS grib filter

รองรับเฉพาะ: grid template 3.0 (lat/lon ปกติ), product template 4.8 (ค่าสะสมช่วงเวลา),
data template 5.0 (simple packing) และ bitmap แบบไม่มี/มี (section 6)
ใช้ Python มาตรฐานเท่านั้น
"""
import struct
from dataclasses import dataclass, field


@dataclass
class Grid:
    ni: int            # จำนวนคอลัมน์ (ลองจิจูด)
    nj: int            # จำนวนแถว (ละติจูด)
    lat1: float        # ละติจูดจุดแรก
    lon1: float
    lat2: float
    lon2: float
    di: float
    dj: float
    scan: int          # scanning mode flags


@dataclass
class Message:
    grid: Grid
    forecast_hour: int        # ชั่วโมงเริ่มช่วงสะสม นับจาก init
    range_hours: int          # ความยาวช่วงสะสม (ชม.)
    stat_type: int            # 1 = accumulation
    values: list = field(default_factory=list)   # เรียงตาม scan (แถวแรก = lat1)

    @property
    def end_hour(self) -> int:
        return self.forecast_hour + self.range_hours


def _s16(b: bytes) -> int:
    """int16 แบบ sign-magnitude ตามสเปก GRIB2"""
    v = struct.unpack('>H', b)[0]
    return -(v & 0x7FFF) if v & 0x8000 else v


def _s32(b: bytes) -> int:
    v = struct.unpack('>I', b)[0]
    return -(v & 0x7FFFFFFF) if v & 0x80000000 else v


def _unpack_bits(data: bytes, nbits: int, n: int) -> list:
    out = []
    if nbits == 0:
        return [0] * n
    bitpos = 0
    mask = (1 << nbits) - 1
    big = int.from_bytes(data, 'big')
    total = len(data) * 8
    for _ in range(n):
        shift = total - bitpos - nbits
        out.append((big >> shift) & mask)
        bitpos += nbits
    return out


def parse(buf: bytes) -> list:
    """คืนรายการ Message ทุกตัวในไฟล์"""
    msgs = []
    pos = 0
    while pos + 16 <= len(buf):
        if buf[pos:pos + 4] != b'GRIB':
            raise ValueError('ไม่ใช่ GRIB2 ที่ตำแหน่ง %d' % pos)
        total = struct.unpack('>Q', buf[pos + 8:pos + 16])[0]
        msgs.append(_parse_message(buf[pos:pos + total]))
        pos += total
    return msgs


def _parse_message(m: bytes) -> Message:
    pos = 16
    grid = None
    fh = rng = stat = None
    ref = scale_e = scale_d = nbits = None
    npts = 0
    bitmap = None
    values = None
    while pos < len(m) - 4:
        if m[pos:pos + 4] == b'7777':
            break
        ln, sec = struct.unpack('>IB', m[pos:pos + 5])
        s = m[pos:pos + ln]
        if sec == 3:
            tmpl = struct.unpack('>H', s[12:14])[0]
            if tmpl != 0:
                raise ValueError('grid template %d ไม่รองรับ' % tmpl)
            ni, nj = struct.unpack('>II', s[30:38])
            lat1 = _s32(s[46:50]) / 1e6
            lon1 = _s32(s[50:54]) / 1e6
            lat2 = _s32(s[55:59]) / 1e6
            lon2 = _s32(s[59:63]) / 1e6
            di = struct.unpack('>I', s[63:67])[0] / 1e6
            dj = struct.unpack('>I', s[67:71])[0] / 1e6
            scan = s[71]
            grid = Grid(ni, nj, lat1, lon1, lat2, lon2, di, dj, scan)
        elif sec == 4:
            tmpl = struct.unpack('>H', s[7:9])[0]
            if tmpl not in (8, 0):
                raise ValueError('product template %d ไม่รองรับ' % tmpl)
            unit = s[17]
            fh = struct.unpack('>I', s[18:22])[0]
            if unit == 1:       # hour
                pass
            elif unit == 0:     # minute
                fh //= 60
            elif unit == 10:    # 3 hours
                fh *= 3
            elif unit == 11:
                fh *= 6
            elif unit == 12:
                fh *= 12
            if tmpl == 8:
                stat = s[46]
                runit = s[48]
                rng = struct.unpack('>I', s[49:53])[0]
                if runit == 10:
                    rng *= 3
                elif runit == 11:
                    rng *= 6
                elif runit == 12:
                    rng *= 12
            else:
                stat, rng = 0, 0
        elif sec == 5:
            npts = struct.unpack('>I', s[5:9])[0]
            tmpl = struct.unpack('>H', s[9:11])[0]
            if tmpl != 0:
                raise ValueError('data template %d ไม่รองรับ (ต้องเป็น simple packing)' % tmpl)
            ref = struct.unpack('>f', s[11:15])[0]
            scale_e = _s16(s[15:17])
            scale_d = _s16(s[17:19])
            nbits = s[19]
        elif sec == 6:
            ind = s[5]
            if ind == 0:
                bits = _unpack_bits(s[6:], 1, grid.ni * grid.nj)
                bitmap = bits
            elif ind != 255:
                raise ValueError('bitmap indicator %d ไม่รองรับ' % ind)
        elif sec == 7:
            raw = _unpack_bits(s[5:], nbits, npts)
            f = (2.0 ** scale_e) / (10.0 ** scale_d)
            vals = [ref * (10.0 ** -scale_d) + x * f for x in raw] if nbits else [ref * (10.0 ** -scale_d)] * npts
            if bitmap is not None:
                it = iter(vals)
                values = [next(it) if b else None for b in bitmap]
            else:
                values = vals
        pos += ln
    if grid is None or values is None:
        raise ValueError('ข้อความ GRIB ไม่ครบส่วน')
    return Message(grid, fh, rng, stat, values)


def to_rows(msg: Message) -> list:
    """คืนตาราง [แถว][คอลัมน์] โดยแถว 0 = ละติจูดต่ำสุด (ใต้) คอลัมน์ 0 = ลองจิจูดต่ำสุด"""
    g = msg.grid
    rows = [msg.values[j * g.ni:(j + 1) * g.ni] for j in range(g.nj)]
    if g.scan & 0x80:          # i scans negative (ตะวันออกไปตะวันตก)
        rows = [r[::-1] for r in rows]
    if not (g.scan & 0x40):    # j scans negative = แถวแรกคือเหนือ -> กลับให้ใต้ก่อน
        rows = rows[::-1]
    return rows


def lat_lon_of(msg: Message):
    """ละติจูด/ลองจิจูดต่ำสุด และ step หลังจัดเรียงด้วย to_rows"""
    g = msg.grid
    lat0 = min(g.lat1, g.lat2)
    lon0 = min(g.lon1, g.lon2)
    return lat0, lon0, g.dj, g.di
