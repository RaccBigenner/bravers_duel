import { describe, expect, it } from 'vitest';
import { mutationRequestProblem } from '../shared/requestSecurity';

const valid = {
  contentType: 'application/json; charset=utf-8',
  origin: 'https://cards.racc.games',
  fetchSite: 'same-origin',
  expectedOrigin: 'https://cards.racc.games',
};

describe('管理API mutation境界', () => {
  it('same-origin application/jsonだけを許可する', () => {
    expect(mutationRequestProblem(valid)).toBeNull();
    expect(
      mutationRequestProblem({ ...valid, contentType: 'text/plain' })?.status,
    ).toBe(415);
    expect(
      mutationRequestProblem({
        ...valid,
        origin: 'https://attacker.example',
      })?.status,
    ).toBe(403);
    expect(
      mutationRequestProblem({ ...valid, fetchSite: 'cross-site' })?.status,
    ).toBe(403);
    expect(
      mutationRequestProblem({ ...valid, origin: null })?.status,
    ).toBe(403);
  });

  it('ローカルtunnelはscheme差だけを許しHostを固定する', () => {
    expect(
      mutationRequestProblem({
        contentType: 'application/json',
        origin: 'https://cards.racc.games',
        fetchSite: 'same-origin',
        expectedHost: 'cards.racc.games',
      }),
    ).toBeNull();
    expect(
      mutationRequestProblem({
        contentType: 'application/json',
        origin: 'https://evil.racc.games',
        fetchSite: 'same-site',
        expectedHost: 'cards.racc.games',
      })?.status,
    ).toBe(403);
  });
});
