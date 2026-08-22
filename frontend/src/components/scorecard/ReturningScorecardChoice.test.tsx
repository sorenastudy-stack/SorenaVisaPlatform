import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReturningScorecardChoice } from './ReturningScorecardChoice';

describe('ReturningScorecardChoice', () => {
  it('offers the latest result and an explicit blank retake path', () => {
    render(<ReturningScorecardChoice latestCompletedAt="2026-08-21T05:26:38.804Z" />);

    expect(screen.getByRole('link', { name: /View latest result/i }).getAttribute('href'))
      .toBe('/scorecard/result');
    expect(screen.getByRole('link', { name: /Start a new assessment/i }).getAttribute('href'))
      .toBe('/scorecard?retake=1');
    expect(screen.getByText(/21 August 2026/)).toBeTruthy();
    expect(screen.getByText(/earlier result stays in history/i)).toBeTruthy();
  });
});
