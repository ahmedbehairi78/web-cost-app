/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyFormatPainterClipboard,
  applySelectionColor,
  applySelectionFontSize,
  applySelectionShade,
  canSelectionUndo,
  clearSelectionUndo,
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

  it('format painter copies bold+color onto another selection', () => {
    document.body.innerHTML =
      '<p id="src"><span style="font-weight:700;color:#ff0000">Source</span></p><p id="dst">Target text</p>';
    clearSelectionUndo(document);
    selectAllText('#src span');
    const clip = readSelectionFormatState(document);
    clip.bold = true;
    clip.color = '#ff0000';
    selectAllText('#dst');
    expect(applyFormatPainterClipboard(document, clip, 'ltr')).toBe(true);
    const dst = document.getElementById('dst')!;
    expect(dst.innerHTML.toLowerCase()).toMatch(/font-weight:\s*700|bold/i);
    expect(dst.innerHTML.toLowerCase()).toMatch(/#ff0000|rgb\(\s*255/);
  });
});
