/**
 * PR-PROVIDER-PORTAL slice E (follow-up) — the country multi-select.
 *
 * Rendered rather than unit-tested around, for the reason the assessment-picker
 * test spells out: what a picker EMITS is the thing that matters, and a helper
 * called directly can agree with itself while the component sends something else
 * entirely. Here the risk is precise — the user reads "Pakistan" and the
 * database must receive "PK". A test that asserted on names would pass while
 * every group was stored unusably.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CountryMultiSelect } from './CountryMultiSelect';

/** Renders with real state, so `value` reflects what the component emitted. */
function Harness({ initial = [], max }: { initial?: string[]; max?: number }) {
  const [value, setValue] = (require('react') as typeof import('react')).useState<string[]>(initial);
  return (
    <>
      <CountryMultiSelect value={value} onChange={setValue} max={max} />
      <output data-testid="emitted">{value.join(',')}</output>
    </>
  );
}

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { expanded: false }));
};
const emitted = () => screen.getByTestId('emitted').textContent;

describe('picking countries by name stores codes', () => {
  it('shows country names, and emits the alpha-2 code', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);

    await user.type(screen.getByLabelText('Search countries'), 'Pakistan');
    const option = await screen.findByRole('option', { name: /Pakistan/ });
    expect(option.textContent).toContain('Pakistan'); // the human-readable half
    await user.click(option);

    expect(emitted()).toBe('PK'); // the stored half
  });

  it('puts the country you typed FIRST, not one that merely contains the word', async () => {
    // "India" matches "British Indian Ocean Territory" too, and alphabetically
    // that sorts above it — so a fast click landed on the wrong country.
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);
    await user.type(screen.getByLabelText('Search countries'), 'India');
    const first = (await screen.findAllByRole('option'))[0];
    expect(first.textContent).toContain('India');
    await user.click(first);
    expect(emitted()).toBe('IN');
  });

  it('takes several without closing between choices', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);
    const search = screen.getByLabelText('Search countries');

    for (const [typed, code] of [['Pakistan', 'PK'], ['India', 'IN'], ['Iran', 'IR']] as const) {
      await user.clear(search);
      await user.type(search, typed);
      await user.click((await screen.findAllByRole('option'))[0]);
      expect(emitted()).toContain(code);
    }
    expect(emitted()!.split(',')).toHaveLength(3);
    // The list is still open — otherwise it would be three separate journeys.
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('a second click on the same country removes it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);
    await user.type(screen.getByLabelText('Search countries'), 'Pakistan');

    const option = await screen.findByRole('option', { name: /Pakistan/ });
    await user.click(option);
    expect(emitted()).toBe('PK');
    await user.click(option);
    expect(emitted()).toBe('');
  });

  it('never emits the same country twice', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['PK']} />);
    await open(user);
    await user.type(screen.getByLabelText('Search countries'), 'Pakistan');
    const option = await screen.findByRole('option', { name: /Pakistan/ });
    // Already selected, so this toggles OFF rather than appending a duplicate.
    await user.click(option);
    expect(emitted()).toBe('');
  });
});

describe('removing a selection before saving', () => {
  it('a chosen country can be removed from its chip', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['PK', 'IN', 'IR']} />);

    expect(emitted()).toBe('PK,IN,IR');
    await user.click(screen.getByRole('button', { name: 'Remove India' }));
    expect(emitted()).toBe('PK,IR');
  });

  it('removing does not disturb the order of the rest', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['PK', 'IN', 'IR', 'BD']} />);
    await user.click(screen.getByRole('button', { name: 'Remove Pakistan' }));
    expect(emitted()).toBe('IN,IR,BD');
  });

  it('the chips read as names, not codes', () => {
    render(<Harness initial={['PK']} />);
    expect(screen.getByRole('button', { name: 'Remove Pakistan' })).toBeTruthy();
  });
});

describe('what it will not do', () => {
  it('offers nothing for a nonsense search — never everything', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);
    await user.type(screen.getByLabelText('Search countries'), 'zzzzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No country matches that.')).toBeTruthy();
  });

  it('cannot emit a code that is not a real country', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);
    // Every option comes from the shared ISO catalogue, so a typo has nowhere to
    // enter: the search box filters, it does not create.
    await user.type(screen.getByLabelText('Search countries'), 'ZZ');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(emitted()).toBe('');
  });

  it('stops at the maximum and says so', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['PK', 'IN']} max={2} />);
    await open(user);
    expect(screen.getByText(/maximum of 2/)).toBeTruthy();

    await user.type(screen.getByLabelText('Search countries'), 'Iran');
    const option = await screen.findByRole('option', { name: /Iran/ });
    expect(option.hasAttribute('disabled')).toBe(true);
    await user.click(option);
    expect(emitted()).toBe('PK,IN'); // unchanged
  });
});

describe('an existing group opens with its countries already chosen', () => {
  it('accepts stored codes as its starting value', () => {
    // Groups created through the old comma-separated box store exactly this
    // shape, which is why replacing the input needed no data migration.
    render(<Harness initial={['IN', 'IR', 'PK']} />);
    expect(emitted()).toBe('IN,IR,PK');
    for (const name of ['Remove India', 'Remove Islamic Republic of Iran', 'Remove Pakistan']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('tolerates lower-case codes from older data', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['pk', 'in']} />);
    expect(screen.getByRole('button', { name: 'Remove Pakistan' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove Pakistan' }));
    expect(emitted()).toBe('in');
  });
});
