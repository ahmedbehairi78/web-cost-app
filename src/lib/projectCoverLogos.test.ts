import { describe, expect, it } from 'vitest';
import {
  mergeCompanyPrintInfoWithProject,
  normalizeProjectCoverLogoPath,
} from './projectCoverLogos';

describe('normalizeProjectCoverLogoPath', () => {
  it('keeps http(s) URLs', () => {
    expect(normalizeProjectCoverLogoPath('https://cdn.example/logo.png')).toBe(
      'https://cdn.example/logo.png',
    );
  });

  it('converts Windows public/branding path to web path', () => {
    expect(
      normalizeProjectCoverLogoPath(
        String.raw`D:\cost web app\web-cost-app\public\branding\jll.png`,
      ),
    ).toBe('/branding/jll.png');
  });

  it('encodes spaces in branding filenames', () => {
    expect(
      normalizeProjectCoverLogoPath(
        String.raw`D:\cost web app\web-cost-app\public\branding\emaar logo.png`,
      ),
    ).toBe('/branding/emaar%20logo.png');
    expect(normalizeProjectCoverLogoPath('/branding/cairo gate.png')).toBe(
      '/branding/cairo%20gate.png',
    );
  });

  it('treats bare filename as /branding/…', () => {
    expect(normalizeProjectCoverLogoPath('jll.png')).toBe('/branding/jll.png');
  });
});

describe('mergeCompanyPrintInfoWithProject', () => {
  const company = {
    companyName: 'Concord',
    headerLogo: '/branding/logo-print.svg',
    headerLogoLeft: '/branding/company-left.png',
    headerLogoRight: '/branding/company-right.png',
  };

  it('keeps company logos when project has none', () => {
    expect(mergeCompanyPrintInfoWithProject(company, null)).toEqual(company);
    expect(mergeCompanyPrintInfoWithProject(company, {})).toEqual(company);
  });

  it('overrides only provided project logo slots and normalizes paths', () => {
    const merged = mergeCompanyPrintInfoWithProject(company, {
      coverLogoLeft: String.raw`D:\app\public\branding\jll.png`,
      coverLogoRight: '  ',
    });
    expect(merged.headerLogoLeft).toBe('/branding/jll.png');
    expect(merged.headerLogo).toBe('/branding/logo-print.svg');
    expect(merged.headerLogoRight).toBe('/branding/company-right.png');
  });
});
