import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  parseAddress,
  participantNames,
  resolveCidImages,
  shortName,
  visibleAttachments,
} from './gmailFormat';

describe('gmailFormat', () => {
  it('splits a name and an address', () => {
    expect(parseAddress('"LUCKY STAR" <a@b.com>')).toEqual({ name: 'LUCKY STAR', email: 'a@b.com' });
    expect(parseAddress('a@b.com')).toEqual({ name: '', email: 'a@b.com' });
    expect(shortName('noreply@grab.com')).toBe('noreply');
  });

  it('lists participant names, keeping commas inside quotes', () => {
    expect(participantNames('"Nhanhoa, Inc" <x@n.vn>, Mail Delivery Subsystem <m@g.com>, c@d.com')).toBe(
      'Nhanhoa, Inc, Mail Delivery Subsystem, c'
    );
  });

  it('decodes HTML entities in snippets', () => {
    expect(decodeEntities('Here&#39;s what &amp; more')).toBe("Here's what & more");
    expect(decodeEntities('plain')).toBe('plain');
  });

  it('points cid images at their attachment and hides them from the chips', () => {
    const atts = [
      { id: 7, content_id: 'icon@mail' },
      { id: 8, content_id: '' },
    ];
    const html = '<img src="cid:icon@mail"><img src="cid:missing">';
    expect(resolveCidImages(html, atts, (a) => `/dl/${a.id}`)).toBe('<img src="/dl/7"><img src="cid:missing">');
    expect(visibleAttachments(atts, html).map((a) => a.id)).toEqual([8]);
    expect(visibleAttachments(atts, '<p>no images</p>').map((a) => a.id)).toEqual([7, 8]);
  });
});
