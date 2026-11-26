import type { OutlookFolder, OutlookMessage } from '../../services/outlookApi';
import { parseAddress } from '../gmail/gmailFormat';

/**
 * Who a reply goes to: the newest message someone else sent (the conversation also holds my own replies from
 * Sent Items). When every message is mine, reply to my latest one and keep its recipients.
 */
export function replyTarget(
  messages: Pick<OutlookMessage, 'message_id' | 'from_addr' | 'to_addrs'>[],
  myEmail: string
): { messageId: string; to: string } | null {
  if (messages.length === 0) return null;
  const me = myEmail.trim().toLowerCase();
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (parseAddress(m.from_addr).email.toLowerCase() !== me) return { messageId: m.message_id, to: m.from_addr };
  }
  const last = messages[messages.length - 1];
  return { messageId: last.message_id, to: last.to_addrs };
}

/** Outlook's own folders, in the order they are shown, with Vietnamese names. */
export const WELL_KNOWN_LABELS: Record<string, string> = {
  inbox: 'Hộp thư đến',
  sentitems: 'Đã gửi',
  drafts: 'Thư nháp',
  archive: 'Lưu trữ',
  deleteditems: 'Đã xoá',
  junkemail: 'Thư rác',
};
const WELL_KNOWN_ORDER = Object.keys(WELL_KNOWN_LABELS);

export interface FolderNode extends OutlookFolder {
  label: string;
  depth: number;
  children: FolderNode[];
}

export const folderLabel = (f: Pick<OutlookFolder, 'well_known' | 'name'>): string =>
  (f.well_known && WELL_KNOWN_LABELS[f.well_known]) || f.name;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

const byName = (a: FolderNode, b: FolderNode) => a.label.localeCompare(b.label, 'vi', { sensitivity: 'base', numeric: true });

/**
 * Folders (flat, as Graph lists them) → a tree. `system` holds Outlook's own top-level folders in a fixed order;
 * `custom` holds every other top-level folder (the customer folders), sorted by name.
 */
export function buildFolderTree(folders: OutlookFolder[]): { system: FolderNode[]; custom: FolderNode[] } {
  const nodes = new Map<string, FolderNode>();
  folders.forEach((f) => nodes.set(f.id, { ...f, label: folderLabel(f), depth: 0, children: [] }));
  const roots: FolderNode[] = [];
  nodes.forEach((n) => {
    const parent = n.parent_id ? nodes.get(n.parent_id) : undefined;
    if (parent && parent !== n) parent.children.push(n);
    else roots.push(n);
  });
  const finish = (list: FolderNode[], depth: number) => {
    list.sort(byName);
    list.forEach((n) => {
      n.depth = depth;
      finish(n.children, depth + 1);
    });
  };
  finish(roots, 0);
  const system = roots
    .filter((r) => r.well_known)
    .sort((a, b) => WELL_KNOWN_ORDER.indexOf(a.well_known) - WELL_KNOWN_ORDER.indexOf(b.well_known));
  const custom = roots.filter((r) => !r.well_known);
  return { system, custom };
}

/** Keep the nodes whose name matches (accents ignored), plus the parents that lead to them. */
export function filterFolderTree(nodes: FolderNode[], query: string): FolderNode[] {
  const q = fold(query.trim());
  if (!q) return nodes;
  const walk = (list: FolderNode[]): FolderNode[] =>
    list.flatMap((n) => {
      const kids = walk(n.children);
      return fold(n.label).includes(q) || kids.length > 0 ? [{ ...n, children: kids }] : [];
    });
  return walk(nodes);
}

/** Depth-first list of every node, for pickers ("move to folder"). */
export function flattenFolderTree(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((n) => [n, ...flattenFolderTree(n.children)]);
}
