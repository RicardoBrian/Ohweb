#!/usr/bin/env python3
"""순서도 JSON → 자체 완결 HTML(언어별 파일). 규칙·쓰는 법은 README.md.

    python3 flowchart.py bomb.json -o out/            # spec 의 langs 전부
    python3 flowchart.py bomb.json -o out/ --lang ko  # 한 언어만
"""
import argparse, html, json, os, sys

CX = 330          # 가운데 줄 x
VW = 660          # viewBox 폭
WARN = []

# ── 색: (글자 라이트, 글자 다크, 서랍 색 칩) ─────────────────────────────
PAL = {
    # 앱인벤터
    'ai.ctrl':  ('#9a7a22', '#e2c069', '#B18E35'),
    'ai.logic': ('#4f8a1f', '#9fd46a', '#77AB41'),
    'ai.math':  ('#3F71B5', '#86a9ea', '#3F71B5'),
    'ai.text':  ('#B32D5E', '#ee7aa3', '#B32D5E'),
    'ai.color': ('#666666', '#bbbbbb', '#7D7D7D'),
    'ai.list':  ('#1f7fae', '#6cc3ea', '#49A6D4'),
    'ai.var':   ('#b5481b', '#f0906a', '#D05F2D'),
    'ai.set':   ('#266643', '#62c58c', '#266643'),
    'ai.call':  ('#7C5385', '#c49be0', '#7C5385'),
    # 스크래치
    'sc.motion':    ('#2f6fd8', '#7fb0ff', '#4C97FF'),
    'sc.looks':     ('#7a4fd6', '#b99cff', '#9966FF'),
    'sc.sound':     ('#b043b0', '#e48fe4', '#CF63CF'),
    'sc.events':    ('#a67c00', '#ffd24d', '#FFBF00'),
    'sc.control':   ('#b87300', '#ffc04d', '#FFAB19'),
    'sc.sensing':   ('#2a87ad', '#7fd0ee', '#5CB1D6'),
    'sc.operators': ('#2e8a2e', '#8fdc8f', '#59C059'),
    'sc.vars':      ('#c2610a', '#ffaa55', '#FF8C1A'),
    'sc.myblocks':  ('#d63a58', '#ff95a8', '#FF6680'),
}
CAT_LABEL = {  # 칩에 적는 서랍 이름
    'ai.ctrl': {'ko': '이벤트·제어', 'en': 'Control', 'zh': '控制', 'ru': 'Управление'},
    'ai.logic': {'ko': '논리', 'en': 'Logic', 'zh': '逻辑', 'ru': 'Логика'},
    'ai.math': {'ko': '수학', 'en': 'Math', 'zh': '数学', 'ru': 'Математика'},
    'ai.text': {'ko': '텍스트', 'en': 'Text', 'zh': '文本', 'ru': 'Текст'},
    'ai.color': {'ko': '색상', 'en': 'Colors', 'zh': '颜色', 'ru': 'Цвета'},
    'ai.list': {'ko': '리스트', 'en': 'Lists', 'zh': '列表', 'ru': 'Списки'},
    'ai.var': {'ko': '변수', 'en': 'Variables', 'zh': '变量', 'ru': 'Переменные'},
    'ai.set': {'ko': '컴포넌트 속성', 'en': 'Component properties', 'zh': '组件属性', 'ru': 'Свойства компонента'},
    'ai.call': {'ko': '컴포넌트 호출', 'en': 'Component calls', 'zh': '组件调用', 'ru': 'Вызовы компонента'},
    'sc.motion': {'ko': '동작', 'en': 'Motion', 'zh': '动作', 'ru': 'Движение'},
    'sc.looks': {'ko': '형태', 'en': 'Looks', 'zh': '外观', 'ru': 'Внешний вид'},
    'sc.sound': {'ko': '소리', 'en': 'Sound', 'zh': '声音', 'ru': 'Звук'},
    'sc.events': {'ko': '이벤트', 'en': 'Events', 'zh': '事件', 'ru': 'События'},
    'sc.control': {'ko': '제어', 'en': 'Control', 'zh': '控制', 'ru': 'Управление'},
    'sc.sensing': {'ko': '감지', 'en': 'Sensing', 'zh': '侦测', 'ru': 'Сенсоры'},
    'sc.operators': {'ko': '연산', 'en': 'Operators', 'zh': '运算', 'ru': 'Операторы'},
    'sc.vars': {'ko': '변수', 'en': 'Variables', 'zh': '变量', 'ru': 'Переменные'},
    'sc.myblocks': {'ko': '나만의 블록', 'en': 'My Blocks', 'zh': '自制积木', 'ru': 'Мои блоки'},
}
SHAPE_LABEL = {
    'term': {'ko': '터미널', 'en': 'Terminal', 'zh': '起止', 'ru': 'Начало/конец'},
    'proc': {'ko': '처리', 'en': 'Process', 'zh': '处理', 'ru': 'Действие'},
    'dec': {'ko': '판단', 'en': 'Decision', 'zh': '判断', 'ru': 'Условие'},
    'io': {'ko': '입출력', 'en': 'Input / Output', 'zh': '输入输出', 'ru': 'Ввод/вывод'},
}
SHAPE_DESC = {  # 스펙의 legend 로 덮어쓸 수 있다
    'term': {'ko': '시작 · 끝', 'en': 'Start · End', 'zh': '开始 · 结束', 'ru': 'Старт · конец'},
    'proc': {'ko': '값 정하기 · 계산', 'en': 'Set a value · calculate', 'zh': '设置值 · 计算', 'ru': 'Задать значение · вычислить'},
    'dec': {'ko': '예 / 아니오로 갈라짐', 'en': 'Splits into yes / no', 'zh': '分成 是 / 否', 'ru': 'Разветвление Да / Нет'},
    'io': {'ko': '화면 · 소리 · 입력', 'en': 'Screen · sound · input', 'zh': '屏幕 · 声音 · 输入', 'ru': 'Экран · звук · ввод'},
}
YES_NO = {'ko': ('예', '아니오'), 'en': ('Yes', 'No'), 'zh': ('是', '否'), 'ru': ('Да', 'Нет')}


def die(msg):
    sys.exit('오류: ' + msg)


def tr(x, lang, path):
    """문자열 또는 {언어: 문자열}."""
    if isinstance(x, dict):
        if lang not in x:
            die(f'{path}: "{lang}" 번역이 없다')
        return x[lang]
    return x


def est_width(s, size=13.5):
    w = 0.0
    for ch in s:
        o = ord(ch)
        if ch == ' ':
            w += 0.3
        elif o < 128:
            w += 0.58
        elif 0x0400 <= o <= 0x04FF:
            w += 0.65
        else:
            w += 1.0
    return w * size * 1.04


def parse_lines(step, lang, path):
    """-> [[(cat|None, text), ...], ...]"""
    raw = step.get('lines')
    if raw is None:
        die(f'{path}: lines 가 없다')
    if isinstance(raw, dict):
        if lang not in raw:
            die(f'{path}.lines: "{lang}" 번역이 없다')
        raw = raw[lang]
    out = []
    for li, line in enumerate(raw):
        if isinstance(line, (str, dict)):
            line = [line]
        parts = []
        for pi, p in enumerate(line):
            pp = f'{path}.lines[{li}][{pi}]'
            if isinstance(p, list):
                if len(p) != 2 or p[0] not in PAL:
                    die(f'{pp}: [분류, 글자] 형식이어야 한다. 분류는 {", ".join(PAL)} 중 하나')
                parts.append((p[0], tr(p[1], lang, pp)))
            else:
                parts.append((None, tr(p, lang, pp)))
        out.append(parts)
    return out


class Chart:
    def __init__(self, ctx, lang, idx):
        self.ctx, self.lang, self.idx = ctx, lang, idx
        self.o = []
        self.mid = f'ar{idx}'

    # ── 그리기 조각 ──
    def text_line(self, cx, y, parts, cls='c'):
        segs = []
        for cat, t in parts:
            if cat:
                self.ctx['cats'].add(cat)
                segs.append(f'<tspan class="k-{cat.replace(".", "-")}">{html.escape(t)}</tspan>')
            else:
                segs.append(html.escape(t))
        self.o.append(f'<text x="{cx}" y="{y}" class="{cls}">{" ".join(segs)}</text>')

    def arrow(self, x, y1, y2):
        self.o.append(f'<path class="ln" d="M{x} {y1} V{y2 - 2}" marker-end="url(#{self.mid})"/>')

    def check(self, parts_lines, avail, path):
        for parts in parts_lines:
            w = est_width(' '.join(t for _, t in parts))
            if w > avail:
                WARN.append(f'{path}: 글자가 넘칠 수 있다 ("{" ".join(t for _, t in parts)[:24]}…" 약 {int(w)}px > {int(avail)}px). 줄을 나눠라')

    def box(self, kind, cx, y, w, lines, desc, path):
        n = len(lines)
        if desc:
            h, b0 = 52 + 18 * (n - 1), y + 22
        else:
            h, b0 = 40 + 18 * (n - 1), y + 25
        x0 = cx - w / 2
        self.ctx['shapes'].add(kind)
        if kind == 'term':
            self.o.append(f'<rect class="term" x="{x0:g}" y="{y}" width="{w}" height="{h}" rx="{min(22, h // 2)}"/>')
        elif kind == 'proc':
            self.o.append(f'<rect class="proc" x="{x0:g}" y="{y}" width="{w}" height="{h}" rx="2"/>')
        else:  # io
            self.o.append(f'<polygon class="io" points="{x0 + 16:g},{y} {x0 + w:g},{y} {x0 + w - 16:g},{y + h} {x0:g},{y + h}"/>')
        self.check(lines, w - (24 if kind != 'io' else 52), path)
        for i, parts in enumerate(lines):
            self.text_line(cx, b0 + 18 * i, parts)
        if desc:
            self.o.append(f'<text x="{cx}" y="{b0 + 18 * (n - 1) + 17}" class="d">{html.escape(desc)}</text>')
        return y + h

    def diamond(self, cx, y, w, lines, desc, path):
        n = len(lines)
        th = 18 * n + (17 if desc else 0)
        h = max(84, th + 46)
        cy = y + h / 2
        self.ctx['shapes'].add('dec')
        self.o.append(f'<polygon class="dec" points="{cx},{y} {cx + w / 2:g},{cy:g} {cx},{y + h:g} {cx - w / 2:g},{cy:g}"/>')
        self.check(lines, w * 0.62, path)
        t0 = cy - th / 2 + 14
        for i, parts in enumerate(lines):
            self.text_line(cx, round(t0 + 18 * i), parts)
        if desc:
            self.o.append(f'<text x="{cx}" y="{round(t0 + 18 * (n - 1) + 17)}" class="d">{html.escape(desc)}</text>')
        return y + h, cy

    def label(self, x, y, t, anchor):
        self.o.append(f'<text x="{x}" y="{y}" class="lb" style="text-anchor:{anchor}">{html.escape(t)}</text>')

    # ── 한 줄 단계(터미널/처리/입출력) ──
    def simple(self, s, y, path, w=None):
        kind = {'terminal': 'term', 'process': 'proc', 'io': 'io'}[s['type']]
        lines = parse_lines(s, self.lang, path)
        desc = tr(s.get('desc'), self.lang, path + '.desc') if s.get('desc') else None
        w = s.get('w') or (280 if kind == 'term' else 500)
        return self.box(kind, CX, y, w, lines, desc, path)

    def stack(self, steps, cx, y, w, path, gap=28):
        """같은 줄(열)에 처리/입출력만 쌓는다. 마지막 아래 y 를 돌려준다. (첫 상자는 y 에 놓음)"""
        bottom = None
        for i, s in enumerate(steps):
            if s['type'] not in ('process', 'io'):
                die(f'{path}[{i}]: 분기·반복 안에는 process/io 만 넣을 수 있다')
            lines = parse_lines(s, self.lang, f'{path}[{i}]')
            desc = tr(s.get('desc'), self.lang, f'{path}[{i}].desc') if s.get('desc') else None
            if bottom is not None:
                y = bottom + gap
                self.arrow(cx, bottom, y)
            kind = 'proc' if s['type'] == 'process' else 'io'
            bottom = self.box(kind, cx, y, w, lines, desc, f'{path}[{i}]')
        return bottom

    # ── 전체 ──
    def render(self, ch, path):
        steps = ch['steps']
        group = tr(ch.get('group'), self.lang, path + '.group') if ch.get('group') else None
        if group and (len(steps) < 3 or steps[0]['type'] != 'terminal' or steps[-1]['type'] != 'terminal'):
            die(f'{path}: group 을 쓰려면 steps 의 처음과 끝이 terminal 이어야 한다')
        prev = None   # 가운데 줄에서 다음 화살표가 시작할 y
        y = 16
        g_top = None
        n = len(steps)
        for i, s in enumerate(steps):
            sp = f'{path}.steps[{i}]'
            gap = 28
            if group and (i == 1 or i == n - 1):
                gap = 40
            top = y if prev is None else prev + gap
            if prev is not None:
                self.arrow(CX, prev, top)
            t = s['type']
            if t in ('terminal', 'process', 'io'):
                bottom = self.simple(s, top, sp)
                prev = bottom
                if group and i == 0:
                    g_top = bottom + 14
                if group and i == n - 2:
                    g_bottom = bottom + 12
            elif t == 'decision':
                prev = self.decision(s, top, sp)
                if group and i == n - 2:
                    g_bottom = prev + 12
            elif t == 'loop':
                prev = self.loop(s, top, sp)
                if group and i == n - 2:
                    g_bottom = prev + 12
            else:
                die(f'{sp}: type 은 terminal/process/io/decision/loop 중 하나')
        height = prev + 14
        if group:
            gx = 28
            self.o.insert(0, f'<rect class="grp" x="{gx}" y="{g_top}" width="{VW - 2 * gx}" height="{g_bottom - g_top}" rx="10"/>'
                             f'<text x="{gx + 10}" y="{g_top + 17}" class="gt">{html.escape(group)}</text>')
        return height

    def decision(self, s, top, path):
        lines = parse_lines(s, self.lang, path)
        desc = tr(s.get('desc'), self.lang, path + '.desc') if s.get('desc') else None
        w = s.get('w', 300)
        bottom, cy = self.diamond(CX, top, w, lines, desc, path)
        yes_t, no_t = YES_NO[self.lang] if self.lang in YES_NO else YES_NO['en']
        LX, RX, BW = 150, 510, 220
        vl, vr = CX - w / 2, CX + w / 2
        yb0 = round(cy + 36)
        cols = []
        for x, key, vx, lab, anchor in ((LX, 'yes', vl, yes_t, 'end'), (RX, 'no', vr, no_t, 'start')):
            body = s.get(key) or []
            self.label(round(vx - 8 if anchor == 'end' else vx + 8), round(cy - 8), lab, anchor)
            cols.append((x, body, vx))
        if not cols[0][1] and not cols[1][1]:
            die(f'{path}: yes/no 중 하나는 비어 있지 않아야 한다')
        bottoms = []
        for x, body, vx in cols:
            if body:
                self.o.append(f'<path class="ln" d="M{vx:g} {cy:g} H{x} V{yb0 - 2}" marker-end="url(#{self.mid})"/>')
                bottoms.append(self.stack(body, x, yb0, BW, path + ('.yes' if x == LX else '.no')))
            else:
                bottoms.append(None)
        yj = max(b for b in bottoms if b) + 24
        for (x, body, vx), b in zip(cols, bottoms):
            if b:
                self.o.append(f'<path class="ln" d="M{x} {b} V{yj}"/>')
            else:
                self.o.append(f'<path class="ln" d="M{vx:g} {cy:g} H{x} V{yj}"/>')
        self.o.append(f'<path class="ln" d="M{LX} {yj} H{RX}"/>')
        return yj

    def loop(self, s, top, path):
        lines = parse_lines(s, self.lang, path)
        desc = tr(s.get('desc'), self.lang, path + '.desc') if s.get('desc') else None
        w = s.get('w', 300)
        body = s.get('body') or []
        if not body:
            die(f'{path}: body 가 비어 있다')
        bottom, cy = self.diamond(CX, top, w, lines, desc, path)
        yes_t, no_t = YES_NO[self.lang] if self.lang in YES_NO else YES_NO['en']
        self.label(CX + 8, round(bottom + 18), yes_t, 'start')
        self.label(round(CX - w / 2 - 8), round(cy - 8), no_t, 'end')
        yb0 = bottom + 28
        self.arrow(CX, bottom, yb0)
        yb = self.stack(body, CX, yb0, 500, path + '.body')
        # 되돌아가는 선(오른쪽)과 빠져나가는 선(왼쪽)
        self.o.append(f'<path class="ln" d="M{CX} {yb} V{yb + 18} H604 V{cy:g} H{CX + w / 2:g}" marker-end="url(#{self.mid})"/>')
        self.o.append(f'<path class="ln" d="M{CX - w / 2:g} {cy:g} H56 V{yb + 48} H{CX}"/>')
        return yb + 48

    def svg(self, ch, path, title):
        h = self.render(ch, path)
        return (f'<svg viewBox="0 0 {VW} {h}" role="img" aria-label="{html.escape(title)}">'
                f'<defs><marker id="{self.mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                f'<path d="M0 0L10 5L0 10z"/></marker></defs>' + ''.join(self.o) + '</svg>')


def css(cats):
    light = ''.join(f'--k-{c.replace(".", "-")}:{PAL[c][0]};' for c in sorted(cats))
    dark = ''.join(f'--k-{c.replace(".", "-")}:{PAL[c][1]};' for c in sorted(cats))
    cls = ''.join(f'.k-{c.replace(".", "-")}{{fill:var(--k-{c.replace(".", "-")})}}' for c in sorted(cats))
    return f'''
:root{{--bg:#fff;--fg:#1f2328;--mut:#5b636e;--bd:#d9dde3;--ln:#5f6670;--tm:#f3f4f6;--tms:#7c838c;--pr:#f4f8fe;--prs:#3b6fc4;--io:#f3faf5;--ios:#2f8a4c;--dc:#fbeccf;--dcs:#c08a1e;--gp:#9aa1ab;{light}}}
@media (prefers-color-scheme:dark){{:root{{--bg:#191919;--fg:#e8e8e8;--mut:#a3a9b1;--bd:#3a3d42;--ln:#a3a9b1;--tm:#26282c;--tms:#8a9099;--pr:#1c2533;--prs:#6f9ce6;--io:#1b2a20;--ios:#5cc07c;--dc:#3d3017;--dcs:#e0b440;--gp:#6f767f;{dark}}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--fg);font-family:"Pretendard","Noto Sans KR","Noto Sans SC","Noto Sans",system-ui,sans-serif;padding:16px}}
.wrap{{max-width:680px;margin:0 auto}}h1{{font-size:18px;margin:0 0 10px}}h2{{font-size:15.5px;margin:26px 0 6px}}
.note{{font-size:12.5px;color:var(--mut);margin:0 0 4px;line-height:1.5}}
.lgd{{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-bottom:10px}}
.li{{display:flex;gap:8px;align-items:center;border:1px solid var(--bd);border-radius:8px;padding:6px 8px;font-size:12.5px}}.li b{{display:block;font-size:13px}}.li span{{color:var(--mut)}}
svg{{display:block}}.wrap>svg{{width:100%;height:auto}}
.term{{fill:var(--tm);stroke:var(--tms)}}.proc{{fill:var(--pr);stroke:var(--prs)}}.io{{fill:var(--io);stroke:var(--ios)}}.dec{{fill:var(--dc);stroke:var(--dcs)}}
.term,.proc,.io,.dec{{stroke-width:2}}
.grp{{fill:none;stroke:var(--gp);stroke-width:1.4;stroke-dasharray:6 4}}.gt{{font-size:12.5px;font-weight:700;fill:var(--mut)}}
.c{{font-size:13.5px;font-weight:700;fill:var(--fg);text-anchor:middle}}.c tspan{{font-weight:800}}.d{{font-size:12px;fill:var(--mut);text-anchor:middle}}
.ln{{fill:none;stroke:var(--ln);stroke-width:1.7}}marker path{{fill:var(--ln)}}
.lb{{font-size:12.5px;font-weight:700;fill:var(--mut)}}
{cls}
.drw{{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}}
.drw span{{font-size:12.5px;font-weight:700;color:#fff;border-radius:5px;padding:3px 8px}}
.drw .lt{{color:#222}}
'''


LEGEND_SVG = {
    'term': '<rect class="term" x="2" y="6" width="40" height="18" rx="9"/>',
    'proc': '<rect class="proc" x="4" y="5" width="36" height="20" rx="2"/>',
    'dec': '<polygon class="dec" points="22,3 42,15 22,27 2,15"/>',
    'io': '<polygon class="io" points="10,5 42,5 34,25 2,25"/>',
}
LIGHT_CHIPS = {'sc.events', 'sc.control', 'sc.sensing', 'sc.operators', 'sc.vars'}  # 밝은 칩은 검은 글자


def build(spec, lang):
    ctx = {'cats': set(), 'shapes': set()}
    title = tr(spec['title'], lang, 'title')
    charts = []
    for i, ch in enumerate(spec['charts']):
        p = f'charts[{i}]'
        ct = tr(ch['title'], lang, p + '.title')
        svg = Chart(ctx, lang, i).svg(ch, p, ct)
        charts.append(f'<h2>{html.escape(ct)}</h2>{svg}')
    legend_over = spec.get('legend', {})
    items = []
    for k in ('term', 'proc', 'dec', 'io'):
        if k not in ctx['shapes']:
            continue
        d = tr(legend_over[k], lang, f'legend.{k}') if k in legend_over else SHAPE_DESC[k].get(lang) or SHAPE_DESC[k]['en']
        name = SHAPE_LABEL[k].get(lang) or SHAPE_LABEL[k]['en']
        items.append(f'<div class="li"><svg viewBox="0 0 44 30" width="44" height="30">{LEGEND_SVG[k]}</svg><div><b>{html.escape(name)}</b><span>{html.escape(d)}</span></div></div>')
    chips = ''.join(
        f'<span class="{"lt" if c in LIGHT_CHIPS else ""}" style="background:{PAL[c][2]}">{html.escape(CAT_LABEL[c].get(lang) or CAT_LABEL[c]["en"])}</span>'
        for c in PAL if c in ctx['cats'])
    note = f'<p class="note">{html.escape(tr(spec["note"], lang, "note"))}</p>' if spec.get('note') else ''
    return (f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title>'
            f'<style>{css(ctx["cats"])}</style></head><body><div class="wrap"><h1>{html.escape(title)}</h1>'
            f'<div class="lgd">{"".join(items)}</div><div class="drw">{chips}</div>{note}{"".join(charts)}</div></body></html>')


def main():
    ap = argparse.ArgumentParser(description='순서도 JSON → HTML')
    ap.add_argument('spec')
    ap.add_argument('-o', '--out', default='.')
    ap.add_argument('--lang', help='쉼표로 구분. 기본은 spec 의 langs')
    a = ap.parse_args()
    with open(a.spec, encoding='utf-8') as f:
        spec = json.load(f)
    langs = a.lang.split(',') if a.lang else spec.get('langs') or ['ko']
    pages = {lang: build(spec, lang) for lang in langs}   # 하나라도 오류면 파일을 만들기 전에 멈춘다
    os.makedirs(a.out, exist_ok=True)
    for lang, page in pages.items():
        out = os.path.join(a.out, f'{spec.get("id", "flow")}_{lang}.html')
        with open(out, 'w', encoding='utf-8') as f:
            f.write(page)
        print('만듦:', out)
    for w in WARN:
        print('주의:', w, file=sys.stderr)


if __name__ == '__main__':
    main()
