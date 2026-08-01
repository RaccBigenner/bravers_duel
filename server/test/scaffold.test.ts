import { describe, expect, it } from 'vitest';
import { SERVER_SCAFFOLD } from '../src/index';

describe('@bravers/server scaffold', () => {
  it('protocol workspaceを解決し、まだ稼働しない雛形である', () => {
    expect(SERVER_SCAFFOLD).toEqual({
      packageName: '@bravers/server',
      protocolVersion: 'OLG-101',
      operational: false,
    });
  });
});
