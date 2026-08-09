/**
 * Merge company print letterhead with optional per-project cover logos.
 * Empty project fields keep the company (or Concord default) logo.
 */
import type { CompanyPrintInfo } from './ipcPrintData';

export type ProjectCoverLogos = {
  coverLogoLeft?: string | null;
  coverLogoCenter?: string | null;
  coverLogoRight?: string | null;
};

/**
 * Normalize pasted logo paths for web use.
 * Accepts `/branding/…`, http(s) URLs, or Windows/absolute paths into `public/branding`.
 * Example: `D:\…\public\branding\jll.png` → `/branding/jll.png`
 */
export function normalizeProjectCoverLogoPath(raw: string | null | undefined): string {
  const trimmed = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
    return trimmed;
  }

  const unified = trimmed.replace(/\\/g, '/');
  const brandingIdx = unified.toLowerCase().lastIndexOf('/branding/');
  if (brandingIdx >= 0) {
    const after = unified.slice(brandingIdx + '/branding/'.length);
    const file = after.split('/').filter(Boolean).pop() || '';
    if (!file) return '';
    return `/branding/${encodeURIComponent(decodeURIComponent(file))}`;
  }

  if (unified.startsWith('/')) {
    // Encode only the last segment so spaces in filenames work (emaar logo.png).
    const parts = unified.split('/');
    const file = parts.pop() || '';
    if (!file) return unified;
    const dir = parts.join('/') || '';
    return `${dir}/${encodeURIComponent(decodeURIComponent(file))}`.replace(/\/{2,}/g, '/');
  }

  // Bare filename → assume public/branding
  if (!unified.includes('/')) {
    return `/branding/${encodeURIComponent(decodeURIComponent(unified))}`;
  }

  return trimmed;
}

export function mergeCompanyPrintInfoWithProject(
  company: CompanyPrintInfo,
  project?: ProjectCoverLogos | null,
): CompanyPrintInfo {
  if (!project) return company;
  const left = normalizeProjectCoverLogoPath(project.coverLogoLeft);
  const center = normalizeProjectCoverLogoPath(project.coverLogoCenter);
  const right = normalizeProjectCoverLogoPath(project.coverLogoRight);
  return {
    ...company,
    ...(left ? { headerLogoLeft: left } : {}),
    ...(center ? { headerLogo: center } : {}),
    ...(right ? { headerLogoRight: right } : {}),
  };
}
