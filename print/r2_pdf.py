#!/usr/bin/env python3
"""Render R2's PDFs: quotes, packing lists and label sheets.

Invoked by PocketBase's pb_hooks (see pocketbase/pb_hooks/lib/pdf.js) as a
subprocess:

    r2_pdf.py quote|packing|labels <input.json> <output.pdf>

The JSON holds everything the document prints (the hooks side builds it from
a quote snapshot or a job summary), so this script never touches the
database. On failure it writes a one-line reason to <output.pdf>.err for the
caller to show, and exits 1.

Fonts are Inter (SIL Open Font License, see fonts/LICENSE.txt), embedded so
names like "Kōwhai" print correctly — PDF's built-in fonts can't do macrons.
"""

import base64
import io
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fpdf import FPDF
from fpdf.enums import MethodReturnValue

FONT_DIR = Path(__file__).resolve().parent / "fonts"
DEFAULT_TZ = "Pacific/Auckland"

INK = (17, 24, 39)
MUTED = (107, 114, 128)
FAINT = (156, 163, 175)
RULE = (229, 231, 235)
RED = (220, 38, 38)

PAGE_W = 210
MARGIN = 15
CONTENT_W = PAGE_W - 2 * MARGIN
LINE = 4.6  # body line height (mm) at 9.5pt


# --- formatting ---


def parse_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).strip().replace(" ", "T").replace("Z", "+00:00"))
    except ValueError:
        return None


def fmt_date(value, tz):
    d = parse_dt(value)
    if not d:
        return ""
    d = d.astimezone(tz)
    return f"{d:%a} {d.day} {d:%b %Y}"


def fmt_time(d):
    hour = d.hour % 12 or 12
    return f"{hour}:{d:%M}{'am' if d.hour < 12 else 'pm'}"


def fmt_datetime(value, tz):
    d = parse_dt(value)
    if not d:
        return ""
    d = d.astimezone(tz)
    return f"{d:%a} {d.day} {d:%b %Y}, {fmt_time(d)}"


def fmt_range(start, end, tz):
    a, b = parse_dt(start), parse_dt(end)
    if not a or not b:
        return ""
    a, b = a.astimezone(tz), b.astimezone(tz)
    if a.date() == b.date():
        return f"{fmt_datetime(start, tz)} – {fmt_time(b)}"
    return f"{fmt_datetime(start, tz)} – {fmt_datetime(end, tz)}"


def money(amount):
    amount = float(amount or 0)
    sign = "−" if amount < 0 else ""
    return f"{sign}${abs(amount):,.2f}"


def number(n):
    n = float(n or 0)
    return str(int(n)) if n == int(n) else f"{n:g}"


# --- document base ---


class Doc(FPDF):
    def __init__(self, footer_left):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.footer_left = footer_left
        self.set_margins(MARGIN, MARGIN, MARGIN)
        # Tables break pages themselves (so headers repeat and rows never
        # split); auto breaks are only switched on for free text.
        self.set_auto_page_break(False, margin=18)
        self.add_font("Inter", "", str(FONT_DIR / "Inter-Regular.ttf"))
        self.add_font("Inter", "B", str(FONT_DIR / "Inter-Bold.ttf"))
        self.add_font("InterSemi", "", str(FONT_DIR / "Inter-SemiBold.ttf"))
        self.set_font("Inter", size=9.5)
        self.set_text_color(*INK)
        self.set_draw_color(*RULE)

    def footer(self):
        self.set_y(-12)
        self.set_font("Inter", size=7.5)
        self.set_text_color(*FAINT)
        self.cell(CONTENT_W / 2, 4, self.footer_left, align="L")
        self.cell(CONTENT_W / 2, 4, f"Page {self.page_no()} of {{nb}}", align="R")

    def font(self, size=9.5, style="", color=INK, semibold=False):
        if semibold:
            self.set_font("InterSemi", size=size)
        else:
            self.set_font("Inter", style=style, size=size)
        self.set_text_color(*color)

    def lines_for(self, width, text):
        if not text:
            return []
        return self.multi_cell(width, LINE, text, dry_run=True, output=MethodReturnValue.LINES)

    def text_block(self, x, y, width, text, size=9.5, color=INK, style="", semibold=False, align="L", line=LINE):
        """Writes wrapped text at (x, y); returns the y below it."""
        if not text:
            return y
        self.font(size, style, color, semibold)
        self.set_xy(x, y)
        self.multi_cell(width, line, text, align=align, new_x="LEFT", new_y="NEXT")
        return self.get_y()

    def space_left(self):
        return self.page_break_trigger - self.get_y()

    def ensure_space(self, height, on_new_page=None):
        if self.get_y() + height > self.page_break_trigger:
            self.add_page()
            if on_new_page:
                on_new_page()

    def rule(self, y, width=0.2, color=RULE, x1=MARGIN, x2=PAGE_W - MARGIN):
        self.set_draw_color(*color)
        self.set_line_width(width)
        self.line(x1, y, x2, y)

    def label(self, x, y, text, width=60):
        self.font(7, color=FAINT, semibold=True)
        self.set_xy(x, y)
        self.cell(width, 3.5, text.upper())
        return y + 4.5


# --- table ---


class Table:
    """Rows that never split across pages, with the header repeated on
    every page. columns: [(key, label, width, align)]."""

    def __init__(self, doc, columns):
        self.doc = doc
        self.columns = columns

    def header(self):
        d = self.doc
        y = d.get_y()
        x = MARGIN
        d.font(8.5, semibold=True)
        for _, label, width, align in self.columns:
            d.set_xy(x, y)
            d.cell(width, 6, label, align=align)
            x += width
        d.rule(y + 6.5, 0.5, INK)
        d.set_y(y + 8)

    def row(self, cells, padding=1.6, rule=True, min_height=0, pad_top=None):
        """cells: {key: {"text", "size", "color", "semibold", "indent",
        "sub" (smaller second line), "box" (draw a tick box)}}."""
        d = self.doc
        heights = []
        for key, _, width, _ in self.columns:
            cell = cells.get(key) or {}
            w = width - cell.get("indent", 0) - 1
            d.font(cell.get("size", 9.5), semibold=cell.get("semibold", False))
            h = len(d.lines_for(w, cell.get("text", ""))) * LINE
            if cell.get("sub"):
                d.font(7.5)
                h += len(d.lines_for(w, cell["sub"])) * 3.8
            heights.append(h)
        top = padding if pad_top is None else pad_top
        height = max(heights + [LINE, min_height]) + top + padding
        d.ensure_space(height, self.header)

        y0 = d.get_y()
        x = MARGIN
        for key, _, width, align in self.columns:
            cell = cells.get(key) or {}
            indent = cell.get("indent", 0)
            if cell.get("box"):
                d.set_draw_color(*MUTED)
                d.set_line_width(0.3)
                d.rect(x + 0.5, y0 + top + 0.6, 3.4, 3.4)
            text = cell.get("text", "")
            if text:
                d.font(cell.get("size", 9.5), color=cell.get("color", INK), semibold=cell.get("semibold", False))
                d.set_xy(x + indent, y0 + top)
                d.multi_cell(width - indent - 1 if align == "L" else width, LINE, text, align=align, new_x="LEFT", new_y="NEXT")
                if cell.get("sub"):
                    d.font(7.5, color=MUTED)
                    d.set_x(x + indent)
                    d.multi_cell(width - indent - 1, 3.8, cell["sub"], align=align, new_x="LEFT", new_y="NEXT")
            x += width
        d.set_y(y0 + height)
        if rule:
            d.rule(y0 + height, 0.15)


# --- quote ---


def group_lines(lines):
    """Lines in their stored order, bucketed by quote heading; auto-added
    lines go under their parent's heading."""
    groups, parent_group = [], {}
    for line in lines:
        name = parent_group.get(line.get("parentLine"), line.get("group", "")) if line.get("parentLine") else line.get("group", "")
        if not line.get("parentLine"):
            parent_group[line["id"]] = name
        group = next((g for g in groups if g["name"] == name), None)
        if group is None:
            group = {"name": name, "lines": []}
            groups.append(group)
        group["lines"].append(line)
    return groups


def render_quote(data, tz):
    s = data["snapshot"]
    business = s.get("business") or {}
    job = s.get("job") or {}
    pricing = s.get("pricing") or {}
    totals = pricing.get("totals") or {}
    quote_no = data["number"]

    doc = Doc(f"{quote_no} · {business.get('name') or ''}".strip(" ·"))
    doc.set_title(f"Quote {quote_no}")
    doc.set_author(business.get("name") or "R2")
    doc.add_page()

    if data.get("status") == "void":
        doc.text_block(MARGIN, MARGIN - 6, CONTENT_W, "VOID — superseded or withdrawn", size=9, color=RED, semibold=True, align="C")

    # Header: business on the left, quote details on the right.
    left = doc.text_block(MARGIN, MARGIN, 110, business.get("name") or "Your business name", size=15, style="B")
    left = doc.text_block(MARGIN, left + 0.5, 110, business.get("address") or "", size=9, color=MUTED, line=4.2)
    contact = " · ".join(v for v in [business.get("phone"), business.get("email")] if v)
    left = doc.text_block(MARGIN, left, 110, contact, size=9, color=MUTED, line=4.2)

    rx, rw = PAGE_W - MARGIN - 70, 70
    right = doc.text_block(rx, MARGIN - 1.5, rw, "QUOTE", size=18, color=FAINT, align="R", line=8)
    right = doc.text_block(rx, right, rw, quote_no, size=10, semibold=True, align="R")
    details = [f"Issued {fmt_date(s.get('issuedAt'), tz)}"]
    if s.get("validUntil"):
        details.append(f"Valid until {fmt_date(s.get('validUntil'), tz)}")
    if business.get("gstNumber"):
        details.append(f"GST no. {business['gstNumber']}")
    right = doc.text_block(rx, right, rw, "\n".join(details), size=9, color=MUTED, align="R", line=4.2)

    # For / Job.
    y = max(left, right) + 8
    col = CONTENT_W / 2
    client = s.get("client")
    yl = doc.label(MARGIN, y, "For")
    if client:
        yl = doc.text_block(MARGIN, yl, col - 5, client.get("name", ""), semibold=True)
        if client.get("contactPerson"):
            yl = doc.text_block(MARGIN, yl, col - 5, f"Attn: {client['contactPerson']}")
        yl = doc.text_block(MARGIN, yl, col - 5, client.get("billingAddress", ""))
        yl = doc.text_block(MARGIN, yl, col - 5, " · ".join(v for v in [client.get("email"), client.get("phone")] if v), color=MUTED)
    else:
        yl = doc.text_block(MARGIN, yl, col - 5, "—", color=FAINT)

    jx = MARGIN + col
    yr = doc.label(jx, y, "Project")
    yr = doc.text_block(jx, yr, col, job.get("name", ""), semibold=True)
    if job.get("reference"):
        yr = doc.text_block(jx, yr, col, f"Your ref: {job['reference']}")
    venue = s.get("venue")
    if venue:
        yr = doc.text_block(jx, yr, col, venue.get("name", "") + (f", {venue['address']}" if venue.get("address") else ""))
    # Quotes from before schedules (migration 0025) have show dates instead.
    if job.get("billingStart"):
        when = fmt_range(job.get("billingStart"), job.get("billingEnd"), tz)
    elif job.get("showStart"):
        when = fmt_range(job.get("showStart"), job.get("showEnd"), tz)
    else:
        when = fmt_range(job.get("prepAt"), job.get("returnAt"), tz)
    yr = doc.text_block(jx, yr, col, when, color=MUTED)

    doc.set_y(max(yl, yr) + 8)

    # Lines.
    table = Table(doc, [("desc", "Description", 98, "L"), ("qty", "Qty", 14, "R"), ("rate", "Rate", 26, "R"), ("disc", "Disc", 14, "R"), ("amount", "Amount", 28, "R")])
    table.header()
    for group in group_lines(s.get("lines") or []):
        if group["name"]:
            subtotal = sum(((l.get("amount") or {}).get("net") or 0) for l in group["lines"])
            # Keep a heading with at least its first line.
            doc.ensure_space(17, table.header)
            table.row(
                {"desc": {"text": group["name"], "semibold": True}, "amount": {"text": money(subtotal), "color": MUTED, "size": 8.5}},
                padding=0.6,
                pad_top=3,
                rule=False,
            )
        for line in group["lines"]:
            child = bool(line.get("parentLine"))
            free_child = child and not line.get("unitPrice")
            unit = "incl." if free_child else money(line.get("unitPrice"))
            if line.get("priceMode") == "per_day" and line.get("lineType") == "custom" and not free_child:
                unit += "/day"
            amount = (line.get("amount") or {}).get("net") or 0
            table.row(
                {
                    "desc": {
                        "text": ("– " if child else "") + (line.get("name") or ""),
                        "indent": 5 if child else 0,
                        "color": MUTED if child else INK,
                        "sub": line.get("description") or "",
                    },
                    "qty": {"text": number(line.get("quantity")), "color": MUTED if child else INK},
                    "rate": {"text": unit, "color": MUTED if child else INK},
                    "disc": {"text": f"{number(line.get('discountPct'))}%" if line.get("discountPct") else ""},
                    "amount": {"text": "" if free_child else money(amount), "color": MUTED if child else INK},
                }
            )

    # Totals, kept together on one page with the pricing note beside them.
    rows_before_total = 2 if totals.get("jobDiscount") else 1
    doc.ensure_space(4 + 5.5 * rows_before_total + 1.5 + 11 + 2 + 8)
    y = doc.get_y() + 4
    days = pricing.get("days", 1)
    note = (
        f"Equipment rates are per day. This hire is charged as {days} day{'s' if days != 1 else ''} "
        f"at {number(pricing.get('factor', 1))}× the day rate. Prices are in NZD."
    )
    doc.text_block(MARGIN, y, 92, note, size=8, color=MUTED, line=3.8)

    tx, tw = PAGE_W - MARGIN - 72, 72
    rows = [("Subtotal", money((totals.get("gross") or 0) - (totals.get("lineDiscount") or 0)), False)]
    if totals.get("jobDiscount"):
        rows.append((f"Discount ({number(pricing.get('discountPct'))}%)", money(-(totals.get("jobDiscount") or 0)), False))
    ty = y
    for label_text, value, _ in rows:
        doc.font(9.5)
        doc.set_xy(tx, ty)
        doc.cell(tw / 2, 5.5, label_text)
        doc.cell(tw / 2, 5.5, value, align="R")
        ty += 5.5
    doc.rule(ty + 0.5, 0.3, (209, 213, 219), tx, tx + tw)
    ty += 1.5
    for label_text, value, strong in [
        ("Total ex GST", money(totals.get("exGst")), True),
        (f"GST {number(pricing.get('gstRate', 15))}%", money(totals.get("gst")), False),
    ]:
        doc.font(9.5, semibold=strong)
        doc.set_xy(tx, ty)
        doc.cell(tw / 2, 5.5, label_text)
        doc.cell(tw / 2, 5.5, value, align="R")
        ty += 5.5
    doc.rule(ty + 0.8, 0.6, INK, tx, tx + tw)
    ty += 2
    doc.font(12, style="B")
    doc.set_xy(tx, ty)
    doc.cell(tw / 2, 7, "Total incl GST")
    doc.cell(tw / 2, 7, money(totals.get("total")), align="R")
    doc.set_y(ty + 12)

    # Free text can run onto further pages.
    doc.set_auto_page_break(True, margin=18)
    for heading, text, size, color in [("Notes", job.get("quoteNotes"), 9.5, INK), ("Terms", s.get("terms"), 8, MUTED)]:
        if not text:
            continue
        doc.ensure_space(14)
        y = doc.label(MARGIN, doc.get_y() + 2, heading)
        doc.text_block(MARGIN, y, CONTENT_W, text, size=size, color=color, line=4.2 if size < 9 else LINE)
        doc.set_y(doc.get_y() + 3)
    return doc


# --- packing list ---

# What the required periods do (web/src/lib/statuses.ts PERIOD_KINDS).
PERIOD_TAGS = {"usage": "Kit booked", "billing": "Billed"}


def render_packing(data, tz):
    job = data["job"]
    business_name = data.get("businessName") or ""
    title = f"#{job['number']} {job['name']}"
    doc = Doc(f"Packing list · {title}")
    doc.set_title(f"Packing list {title}")
    doc.add_page()

    top = doc.text_block(MARGIN, MARGIN, 96, "Packing list" + (f" · {business_name}" if business_name else ""), size=7.5, color=FAINT, semibold=True)
    top = doc.text_block(MARGIN, top + 0.5, 96, title, size=15, style="B")
    who = " · ".join(v for v in [(job.get("clientInfo") or {}).get("name"), (job.get("venueInfo") or {}).get("name")] if v)
    top = doc.text_block(MARGIN, top + 0.5, 96, who)
    top = doc.text_block(MARGIN, top, 96, (job.get("venueInfo") or {}).get("address") or "", color=MUTED)

    rx, rw = PAGE_W - MARGIN - 82, 82
    details = [job.get("status", "").capitalize(), f"Out {fmt_datetime(job.get('prepAt'), tz)}", f"Back {fmt_datetime(job.get('returnAt'), tz)}"]
    right = doc.text_block(rx, MARGIN, rw, "\n".join(details), size=9, align="R", line=4.4)

    doc.set_y(max(top, right) + 7)
    periods = sorted(data.get("periods") or [], key=lambda p: p.get("start") or "")
    if periods:
        schedule = Table(doc, [("what", "Schedule", 52, "L"), ("when", "When", 70, "L"), ("notes", "Notes", 58, "L")])
        schedule.header()
        for p in periods:
            schedule.row(
                {
                    "what": {"text": p.get("name") or "", "semibold": True, "sub": PERIOD_TAGS.get(p.get("kind"), "")},
                    "when": {"text": fmt_range(p.get("start"), p.get("end"), tz)},
                    "notes": {"text": p.get("notes") or "", "color": MUTED},
                },
                padding=1.2,
            )
        doc.set_y(doc.get_y() + 6)
    packed = {p["itemId"]: p for p in (data.get("packing") or {}).get("items", [])}
    lines = [l for l in data.get("lines", []) if l.get("lineType") != "custom"]
    table = Table(doc, [("box", "", 7, "L"), ("qty", "Qty", 13, "R"), ("item", "Item", 104, "L"), ("where", "Where", 34, "L"), ("scanned", "Scanned", 22, "R")])
    table.header()
    for group in group_lines(lines):
        if group["name"]:
            doc.ensure_space(17, table.header)
            table.row({"item": {"text": group["name"], "semibold": True}}, padding=0.6, pad_top=3, rule=False)
        for line in group["lines"]:
            item = line.get("item") or {}
            child = bool(line.get("parentLine"))
            kit = item.get("kind") == "kit"
            p = packed.get(item.get("id")) if item else None
            out = ", ".join(s.get("label") or s.get("barcode") for s in (p or {}).get("serialsOut", []))
            name = ("– " if child else "") + (line.get("name") or "") + (" (kit — contents below)" if kit else "")
            if item.get("code"):
                name += f"  {item['code']}"
            table.row(
                {
                    "box": {"box": not kit},
                    "qty": {"text": number(line.get("quantity")), "semibold": True},
                    "item": {"text": name, "indent": 4 if child else 0, "sub": f"Out: {out}" if out else ""},
                    "where": {"text": item.get("locationInWarehouse") or "", "color": MUTED},
                    "scanned": {"text": f"{p['scannedOut']}/{p['needed']}" if p and not kit else "", "color": MUTED},
                }
            )
    if not lines:
        doc.text_block(MARGIN, doc.get_y() + 2, CONTENT_W, "Nothing to pack on this project.", color=MUTED)

    doc.set_auto_page_break(True, margin=18)
    if job.get("notes"):
        doc.ensure_space(14)
        y = doc.label(MARGIN, doc.get_y() + 4, "Notes")
        doc.text_block(MARGIN, y, CONTENT_W, job["notes"])

    doc.set_auto_page_break(False)
    doc.ensure_space(22)
    y = doc.get_y() + 14
    width = (CONTENT_W - 2 * 8) / 3
    for i, label_text in enumerate(["Packed by", "Checked by", "Returned by"]):
        x = MARGIN + i * (width + 8)
        doc.rule(y, 0.3, FAINT, x, x + width)
        doc.font(7.5, color=MUTED)
        doc.set_xy(x, y + 1)
        doc.cell(width, 4, label_text)
    return doc


# --- labels ---


def render_labels(data, _tz):
    """One page per label at the label's own size, so a Zebra/Brother/Dymo
    driver prints it 1:1. Images arrive as PNG data rendered by the label
    designer at the printer's resolution."""
    doc = FPDF(unit="mm")
    doc.set_auto_page_break(False)
    doc.set_margins(0, 0, 0)
    doc.set_title("Labels")
    for label in data.get("labels", []):
        width, height = float(label["widthMm"]), float(label["heightMm"])
        png = base64.b64decode(label["png"])
        for _ in range(max(1, min(int(label.get("copies", 1)), 100))):
            doc.add_page(format=(width, height))
            doc.image(io.BytesIO(png), x=0, y=0, w=width, h=height)
    return doc


RENDERERS = {"quote": render_quote, "packing": render_packing, "labels": render_labels}


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[1] not in RENDERERS:
        print(__doc__, file=sys.stderr)
        return 2
    kind, input_path, output_path = sys.argv[1:]
    try:
        data = json.loads(Path(input_path).read_text(encoding="utf-8"))
        try:
            tz = ZoneInfo(data.get("timezone") or DEFAULT_TZ)
        except Exception:
            tz = ZoneInfo(DEFAULT_TZ)
        RENDERERS[kind](data, tz).output(output_path)
        return 0
    except Exception as e:  # noqa: BLE001 — anything at all becomes a message for the caller
        Path(output_path + ".err").write_text(f"{type(e).__name__}: {e}", encoding="utf-8")
        return 1


if __name__ == "__main__":
    sys.exit(main())
