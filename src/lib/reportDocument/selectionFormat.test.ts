/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyFormatPainterClipboard,
  applySelectionAlign,
  applySelectionBorder,
  applySelectionColor,
  applySelectionFontSize,
  applySelectionShade,
  applySelectionStylePatches,
  canSelectionUndo,
  clearSelectionUndo,
  extractSelectionStylePatches,
  readSelectionFormatState,
  serializePreviewDocument,
  toggleSelectionBold,
  undoSelectionFormat,
} from './selectionFormat';

function selectAllText(selector = 'p'): void {
  const el = document.querySelector(selector);
  expect(el).toBeTruthy();
  const range = document.createRange();
  range.selectNodeContents(el!);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

afterEach(() => {
  document.body.innerHTML = '';
  clearSelectionUndo(document);
  window.getSelection()?.removeAllRanges();
});

describe('selectionFormat', () => {
  it('applies bold only to the selected text and supports undo', () => {
    document.body.innerHTML = '<p>Hello world</p><p>Other</p>';
    clearSelectionUndo(document);
    selectAllText('p');
    expect(toggleSelectionBold(document)).toBe(true);
    expect(canSelectionUndo(document)).toBe(true);
    const first = document.querySelector('p')!;
    expect(first.innerHTML.toLowerCase()).toMatch(/<(b|strong|span)[\s>]|font-weight/i);
    expect(document.querySelectorAll('p')[1].textContent).toBe('Other');
    expect(undoSelectionFormat(document)).toBe(true);
    expect(document.querySelector('p')!.innerHTML).toBe('Hello world');
  });

  it('wraps selection with font-size and color', () => {
    document.body.innerHTML = '<div class="hdr"><span>Title here</span></div>';
    clearSelectionUndo(document);
    selectAllText('span');
    expect(applySelectionFontSize(document, 14)).toBe(true);
    expect(applySelectionColor(document, '#ff0000')).toBe(true);
    const html = document.body.innerHTML.toLowerCase();
    expect(html).toContain('14pt');
    expect(html).toMatch(/#ff0000|rgb\(\s*255/);
  });

  it('serializes a full preview document', () => {
    document.body.innerHTML = '<div class="sheet">x</div>';
    const html = serializePreviewDocument(document);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('class="sheet"');
  });

  it('shades the whole table cell when selection is inside a cell', () => {
    document.body.innerHTML =
      '<table><tr><td id="c1">Amount 100</td><td id="c2">Other</td></tr></table>';
    clearSelectionUndo(document);
    selectAllText('#c1');
    expect(applySelectionShade(document, '#fef08a')).toBe(true);
    const c1 = document.getElementById('c1')!;
    const c2 = document.getElementById('c2')!;
    expect(c1.style.backgroundColor || c1.style.background).toMatch(/#fef08a|rgb\(\s*254/i);
    expect(c2.style.background || c2.style.backgroundColor || '').toBe('');
    // Should not wrap text highlight spans inside the cell for shade.
    expect(c1.querySelector('[style*="background"]')).toBeNull();
  });

  it('applies font size to the whole table cell without extracting table markup', () => {
    document.body.innerHTML =
      '<table style="table-layout:fixed;width:100%"><tr>' +
      '<td id="c1" class="num"><span class="num-val">14,890.58</span></td>' +
      '<td id="c2" class="num"><span class="num-val">21,272.25</span></td>' +
      '</tr></table>';
    clearSelectionUndo(document);
    selectAllText('#c1');
    expect(applySelectionFontSize(document, 12)).toBe(true);
    const table = document.querySelector('table')!;
    expect(table.querySelectorAll('td')).toHaveLength(2);
    expect(table.style.tableLayout).toBe('auto');
    expect(document.getElementById('c1')!.style.fontSize).toBe('12pt');
    expect(document.getElementById('c1')!.querySelector('.num-val')!.getAttribute('style') || '').toMatch(/12pt/);
    expect(document.getElementById('c2')!.style.fontSize).toBe('');
    expect(document.querySelector('span[data-sel-fmt]')).toBeNull();
  });

  it('does not collapse columns when font size is applied across two cells', () => {
    document.body.innerHTML =
      '<table><tr><td id="a">One</td><td id="b">Two</td></tr></table>';
    clearSelectionUndo(document);
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;
    const range = document.createRange();
    range.setStart(a.firstChild!, 0);
    range.setEnd(b.firstChild!, 3);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(applySelectionFontSize(document, 12)).toBe(true);
    expect(document.querySelectorAll('td')).toHaveLength(2);
    expect(a.style.fontSize).toBe('12pt');
    expect(b.style.fontSize).toBe('12pt');
    expect(a.parentElement?.tagName).toBe('TR');
  });

  it('shades and borders only the cells that contain the selection', () => {
    document.body.innerHTML =
      '<table><tr><td id="a">One</td><td id="b">Two</td><td id="c">Three</td></tr></table>';
    clearSelectionUndo(document);
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;
    const range = document.createRange();
    range.setStart(a.firstChild!, 0);
    range.setEnd(b.firstChild!, 3);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(applySelectionShade(document, '#fef08a')).toBe(true);
    expect(applySelectionBorder(document, 'strong')).toBe(true);
    expect(a.style.background || a.style.backgroundColor).toMatch(/#fef08a|rgb\(\s*254/i);
    expect(b.style.background || b.style.backgroundColor).toMatch(/#fef08a|rgb\(\s*254/i);
    expect(document.getElementById('c')!.style.background || '').toBe('');
    expect(a.style.border).toMatch(/1\.5px|0f172a|#/i);
    expect(document.getElementById('c')!.style.border).toBe('');
    expect(document.querySelector('span[data-sel-fmt]')).toBeNull();
  });

  it('extracts cell styles and reapplies them on a rebuilt table', () => {
    document.body.innerHTML =
      '<table><tr><td id="a">One</td><td id="b">Two</td></tr></table>';
    clearSelectionUndo(document);
    selectAllText('#a');
    expect(applySelectionShade(document, '#fef08a')).toBe(true);
    expect(applySelectionFontSize(document, 12)).toBe(true);
    const patches = extractSelectionStylePatches(document);
    expect(patches.some((p) => p.k === 'c' && p.r === 0 && p.c === 0)).toBe(true);

    document.body.innerHTML =
      '<table><tr><td id="a2">New amount 99</td><td id="b2">Two</td></tr></table>';
    applySelectionStylePatches(document, patches);
    const restored = document.getElementById('a2')!;
    expect(restored.style.fontSize).toBe('12pt');
    expect(restored.style.background || restored.style.backgroundColor).toMatch(/#fef08a|rgb\(\s*254/i);
    expect(document.getElementById('b2')!.style.fontSize).toBe('');
    expect(restored.textContent).toBe('New amount 99');
  });

  it('persists floating-bar header slot formatting (company / title)', () => {
    document.body.innerHTML = `
      <section class="sheet">
        <header class="hdr">
          <div class="brand-text"><p class="co">Concord Plus</p></div>
          <h1 style="color:#003B71">Cash budget</h1>
          <p class="scope">Period</p>
        </header>
      </section>`;
    clearSelectionUndo(document);
    selectAllText('p.co');
    expect(applySelectionFontSize(document, 14)).toBe(true);
    selectAllText('h1');
    expect(applySelectionFontSize(document, 16)).toBe(true);

    const patches = extractSelectionStylePatches(document);
    expect(patches.some((p) => p.k === 'e' && p.slot === 'co' && /14pt/.test(p.s))).toBe(true);
    expect(patches.some((p) => (p.k === 'e' && p.slot === 'h1') || p.k === 'ti')).toBe(true);

    document.body.innerHTML = `
      <section class="sheet">
        <header class="hdr">
          <div class="brand-text"><p class="co">Concord Plus</p></div>
          <h1 style="color:#003B71">Live title</h1>
          <p class="scope">Period</p>
        </header>
      </section>`;
    applySelectionStylePatches(document, patches);
    expect(document.querySelector('p.co')!.style.fontSize).toBe('14pt');
    expect(document.querySelector('h1')!.style.fontSize).toBe('16pt');
    expect(document.querySelector('h1')!.textContent).toBe('Live title');
  });

  it('aligns certificate kv-field values (not only table cells)', () => {
    document.body.innerHTML = `
      <section class="sheet">
        <div class="kv-grid">
          <div class="kv-item">
            <span class="kv-label">المشروع</span>
            <span class="kv-value">كايرو جيت</span>
          </div>
          <div class="kv-item">
            <span class="kv-label">الحالة</span>
            <span class="kv-value">معتمد</span>
          </div>
        </div>
      </section>`;
    clearSelectionUndo(document);
    selectAllText('.kv-value');
    expect(applySelectionAlign(document, 'start', 'rtl')).toBe(true);
    const firstValue = document.querySelector('.kv-value') as HTMLElement;
    expect(firstValue.style.textAlign).toBe('right');
    expect(firstValue.style.marginInlineStart).toBe('0');
    expect(firstValue.style.flex).toMatch(/1/);
    expect((document.querySelectorAll('.kv-value')[1] as HTMLElement).style.textAlign).toBe('');

    const patches = extractSelectionStylePatches(document);
    expect(patches.some((p) => p.k === 'e' && p.slot === 'kv' && p.r === 0 && /text-align/i.test(p.s))).toBe(true);

    document.body.innerHTML = `
      <section class="sheet">
        <div class="kv-grid">
          <div class="kv-item">
            <span class="kv-label">المشروع</span>
            <span class="kv-value">مشروع آخر</span>
          </div>
          <div class="kv-item">
            <span class="kv-label">الحالة</span>
            <span class="kv-value">مسودة</span>
          </div>
        </div>
      </section>`;
    applySelectionStylePatches(document, patches);
    const restored = document.querySelector('.kv-value') as HTMLElement;
    expect(restored.style.textAlign).toBe('right');
    expect(restored.textContent).toBe('مشروع آخر');
    expect((document.querySelectorAll('.kv-value')[1] as HTMLElement).style.textAlign).toBe('');
  });
});
