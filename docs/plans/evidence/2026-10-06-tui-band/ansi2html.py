#!/usr/bin/env python3
"""ansi2html.py <in.ansi> <out.html> [bg] [fg] — tmux `capture-pane -e -p` output to a fixed-grid HTML page.

Handles SGR 0/1/2/3/4/7/9/22/23/24/27/29/30-37/39/40-47/49/90-97/100-107/38;5/48;5/38;2/48;2. CJK cells are
double width (East Asian Wide/Fullwidth). The terminal default bg/fg are parameters (a dark theme by default).
"""
import html, re, sys, unicodedata

BASE16 = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
          '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff']


def xterm256(n):
    if n < 16:
        return BASE16[n]
    if n < 232:
        n -= 16
        steps = [0, 95, 135, 175, 215, 255]
        return '#%02x%02x%02x' % (steps[n // 36], steps[(n // 6) % 6], steps[n % 6])
    v = 8 + (n - 232) * 10
    return '#%02x%02x%02x' % (v, v, v)


def width(ch):
    return 2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1


def main():
    src, out = sys.argv[1], sys.argv[2]
    dbg = sys.argv[3] if len(sys.argv) > 3 else '#1e1e1e'
    dfg = sys.argv[4] if len(sys.argv) > 4 else '#d4d4d4'
    text = open(src, encoding='utf-8', errors='replace').read()
    st = dict(fg=None, bg=None, bold=False, dim=False, ital=False, und=False, inv=False, strike=False)
    rows, cur = [], []
    for tok in re.split(r'(\x1b\[[0-9;:]*[A-Za-z])', text):
        if tok.startswith('\x1b['):
            if not tok.endswith('m'):
                continue
            ps = [p for p in re.split('[;:]', tok[2:-1])] or ['0']
            i = 0
            while i < len(ps):
                p = int(ps[i]) if ps[i] else 0
                if p == 0: st.update(fg=None, bg=None, bold=False, dim=False, ital=False, und=False, inv=False, strike=False)
                elif p == 1: st['bold'] = True
                elif p == 2: st['dim'] = True
                elif p == 3: st['ital'] = True
                elif p == 4: st['und'] = True
                elif p == 7: st['inv'] = True
                elif p == 9: st['strike'] = True
                elif p == 22: st['bold'] = st['dim'] = False
                elif p == 23: st['ital'] = False
                elif p == 24: st['und'] = False
                elif p == 27: st['inv'] = False
                elif p == 29: st['strike'] = False
                elif 30 <= p <= 37: st['fg'] = BASE16[p - 30]
                elif p == 39: st['fg'] = None
                elif 40 <= p <= 47: st['bg'] = BASE16[p - 40]
                elif p == 49: st['bg'] = None
                elif 90 <= p <= 97: st['fg'] = BASE16[p - 90 + 8]
                elif 100 <= p <= 107: st['bg'] = BASE16[p - 100 + 8]
                elif p in (38, 48) and i + 1 < len(ps):
                    key = 'fg' if p == 38 else 'bg'
                    if ps[i + 1] == '5' and i + 2 < len(ps):
                        st[key] = xterm256(int(ps[i + 2])); i += 2
                    elif ps[i + 1] == '2' and i + 4 < len(ps):
                        st[key] = '#%02x%02x%02x' % tuple(int(x or 0) for x in ps[i + 2:i + 5]); i += 4
                i += 1
            continue
        for ch in tok:
            if ch == '\n':
                rows.append(cur); cur = []
                continue
            if ch == '\r':
                continue
            cur.append((ch, dict(st)))
    if cur:
        rows.append(cur)
    out_rows = []
    for row in rows:
        spans = []
        for ch, s in row:
            fg, bg = s['fg'] or dfg, s['bg'] or dbg
            if s['inv']:
                fg, bg = bg, fg
            css = f'color:{fg};background:{bg};'
            if s['bold']: css += 'font-weight:bold;'
            if s['dim']: css += 'opacity:0.55;'
            if s['ital']: css += 'font-style:italic;'
            deco = ' '.join(x for x, on in (('underline', s['und']), ('line-through', s['strike'])) if on)
            if deco: css += f'text-decoration:{deco};'
            w = width(ch)
            spans.append(f'<span style="{css}display:inline-block;width:{w}ch;text-align:center">{html.escape(ch) if ch != " " else "&nbsp;"}</span>')
        out_rows.append('<div class="r">' + ''.join(spans) + '</div>')
    page = f'''<!doctype html><meta charset="utf-8"><style>
body{{margin:0;background:{dbg};}}
.t{{font-family:"DejaVu Sans Mono","WenQuanYi Zen Hei Mono","WenQuanYi Zen Hei",monospace;font-size:15px;line-height:19px;padding:8px;white-space:pre;background:{dbg};color:{dfg}}}
.r{{height:19px}}
</style><div class="t">{''.join(out_rows)}</div>'''
    open(out, 'w', encoding='utf-8').write(page)


main()
