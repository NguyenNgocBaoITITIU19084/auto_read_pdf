import { describe, expect, it } from 'vitest';
import type { OutlookFolder } from '../../services/outlookApi';
import { buildFolderTree, filterFolderTree, flattenFolderTree, replyTarget } from './outlookFolders';

const f = (id: string, name: string, parent = 'root', well_known = ''): OutlookFolder => ({
  id,
  name,
  parent_id: parent,
  well_known,
  unread: 0,
  total: 0,
  child_count: 0,
  pinned: false,
});

describe('outlookFolders', () => {
  const folders = [
    f('nestle', 'NESTLE'),
    f('sent', 'Sent Items', 'root', 'sentitems'),
    f('inbox', 'Inbox', 'root', 'inbox'),
    f('u2', 'U2'),
    f('u1', 'U1'),
    f('duyet', 'Duyet Lenh', 'inbox'),
    f('tekcom', 'TEKCOM'),
    f('tekcom-2025', '2025', 'tekcom'),
  ];

  it('puts Outlook folders first in a fixed order and customer folders by name', () => {
    const { system, custom } = buildFolderTree(folders);
    expect(system.map((n) => n.label)).toEqual(['Hộp thư đến', 'Đã gửi']);
    expect(system[0].children.map((n) => n.label)).toEqual(['Duyet Lenh']);
    expect(custom.map((n) => n.label)).toEqual(['NESTLE', 'TEKCOM', 'U1', 'U2']);
    expect(custom[1].children[0]).toMatchObject({ label: '2025', depth: 1 });
  });

  it('filters by name without accents and keeps the path to a match', () => {
    const { system, custom } = buildFolderTree(folders);
    expect(filterFolderTree(custom, 'nest').map((n) => n.id)).toEqual(['nestle']);
    const viaParent = filterFolderTree(custom, '2025');
    expect(viaParent.map((n) => n.id)).toEqual(['tekcom']);
    expect(viaParent[0].children.map((n) => n.id)).toEqual(['tekcom-2025']);
    expect(filterFolderTree(system, 'duyệt').map((n) => n.id)).toEqual(['inbox']);
    expect(flattenFolderTree(custom)).toHaveLength(5);
  });

  it('replies to the newest message someone else sent, not to my own reply', () => {
    const msgs = [
      { message_id: 'm1', from_addr: 'Lan <lan@nestle.com>', to_addrs: 'Me <me@co.vn>' },
      { message_id: 'm2', from_addr: 'Me <ME@co.vn>', to_addrs: 'Lan <lan@nestle.com>' },
    ];
    expect(replyTarget(msgs, 'me@co.vn')).toEqual({ messageId: 'm1', to: 'Lan <lan@nestle.com>' });
    expect(replyTarget(msgs.slice(1), 'me@co.vn')).toEqual({ messageId: 'm2', to: 'Lan <lan@nestle.com>' });
    expect(replyTarget([], 'me@co.vn')).toBeNull();
  });
});
