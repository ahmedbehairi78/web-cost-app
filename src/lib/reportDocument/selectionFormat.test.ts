/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest';
import {
  applySelectionColor,
  applySelectionFontSize,
  canSelectionUndo,
  clearSelectionUndo,
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
});
