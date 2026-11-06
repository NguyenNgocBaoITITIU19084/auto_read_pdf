import { describe, it, expect } from 'vitest';
import { guessSiteFromDepot } from './vessel';

describe('guessSiteFromDepot', () => {
  it('recognises SP-ITC however it is written', () => {
    expect(['SP-ITC', 'SPITC Terminal', 'Cang SP ITC', 'ITC Phu Huu'].map(guessSiteFromDepot))
      .toEqual(['ITC', 'ITC', 'ITC', 'ITC']);
  });

  it('keeps the other ports as before', () => {
    expect(['Cat Lai', 'TCIT', 'Tan Cang Nhon Trach'].map(guessSiteFromDepot)).toEqual(['CTL', null, 'TNT']);
  });
});
