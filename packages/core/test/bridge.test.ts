import { describe, expect, it } from 'vitest';
import type { BridgeResult, ReleaseIdentity, SourceBridge } from '../src/bridge.js';

// ---------------------------------------------------------------------------
// Compile-time contract: a minimal SourceBridge (no optional hooks) is valid.
// This class must typecheck — the compiler is the assertion.
// ---------------------------------------------------------------------------
class FakeBridge implements SourceBridge {
  async searchTv(
    _title: string,
    _season: number,
    _episode: number,
  ): Promise<BridgeResult[]> {
    return [
      {
        itemId: 'abc123',
        pageUrl: 'https://example.com/watch/abc123',
        sourceTitle: 'Example Show S01E02',
        durationSec: 1800,
        channel: 'ExampleChannel',
      },
    ];
  }

  async searchMovie(_title: string, _year?: number): Promise<BridgeResult[]> {
    return [];
  }
  // infoUrl and releaseName intentionally omitted — both are optional
}

// ---------------------------------------------------------------------------
// Compile-time contract: a bridge that DOES implement the naming hook is valid.
// ---------------------------------------------------------------------------
class FakeBridgeWithNaming extends FakeBridge {
  releaseName(result: BridgeResult, identity: ReleaseIdentity): string {
    if (identity.kind === 'tv') {
      const ss = String(identity.season ?? 1).padStart(2, '0');
      const ee = String(identity.episode ?? 1).padStart(2, '0');
      return `${result.sourceTitle}.S${ss}E${ee}.WEB-DL-${result.channel}`;
    }
    return `${result.sourceTitle}.${identity.year ?? ''}.WEB-DL-${result.channel}`;
  }
}

describe('SourceBridge contract', () => {
  describe('BridgeResult shape', () => {
    it('searchTv returns an array whose first element has all five BridgeResult fields', async () => {
      const bridge = new FakeBridge();
      const results = await bridge.searchTv('Example Show', 1, 2);

      expect(results).toHaveLength(1);
      const [v] = results;
      expect(v).toHaveProperty('itemId');
      expect(v).toHaveProperty('pageUrl');
      expect(v).toHaveProperty('sourceTitle');
      expect(v).toHaveProperty('durationSec');
      expect(v).toHaveProperty('channel');
    });

    it('BridgeResult does NOT have a viewCount field', async () => {
      const bridge = new FakeBridge();
      const [v] = await bridge.searchTv('Example Show', 1, 2);
      expect(v).not.toHaveProperty('viewCount');
    });

    it('searchMovie returns [] when bridge does not carry that content type', async () => {
      const bridge = new FakeBridge();
      const results = await bridge.searchMovie('Example Film', 2020);
      expect(results).toEqual([]);
    });
  });

  describe('optional hooks', () => {
    it('a bridge without infoUrl satisfies SourceBridge (compile-time; verified above)', () => {
      // The FakeBridge class not having infoUrl and still passing tsc is the proof.
      // Cast via the interface to check the optional hook is absent at runtime.
      const bridge: SourceBridge = new FakeBridge();
      expect(bridge.infoUrl).toBeUndefined();
    });

    it('a bridge without releaseName satisfies SourceBridge', () => {
      const bridge: SourceBridge = new FakeBridge();
      expect(bridge.releaseName).toBeUndefined();
    });

    it('a bridge implementing releaseName compiles and returns a string', () => {
      const bridge = new FakeBridgeWithNaming();
      const result: BridgeResult = {
        itemId: 'abc',
        pageUrl: 'https://example.com/abc',
        sourceTitle: 'Some Show',
        durationSec: 1800,
        channel: 'SomeChannel',
      };
      const identity: ReleaseIdentity = { kind: 'tv', season: 1, episode: 2 };
      const name = bridge.releaseName(result, identity);
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    });

    it('ReleaseIdentity with kind=movie carries year', () => {
      const identity: ReleaseIdentity = { kind: 'movie', year: 1959 };
      expect(identity.kind).toBe('movie');
      expect(identity.year).toBe(1959);
      expect(identity.season).toBeUndefined();
      expect(identity.episode).toBeUndefined();
    });
  });
});
