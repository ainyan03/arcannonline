export const MAX_CONNECTING_PEERS = 8;
export const MAX_PEX_DIALS = 4;

/** PEX 1件が接続試行枠を占有しないよう、新規ダイヤル候補を純粋関数で制限する。 */
export function selectPexDialCandidates(
  advertised: readonly string[],
  selfId: string,
  existing: ReadonlySet<string>,
  peerCount: number,
  connectingCount: number,
  maxPeers: number,
): Set<string> {
  const available = Math.max(
    0,
    Math.min(
      MAX_PEX_DIALS,
      MAX_CONNECTING_PEERS - connectingCount,
      maxPeers - peerCount,
    ),
  );
  const selected = new Set<string>();
  for (const id of advertised) {
    if (selected.size >= available) break;
    if (id !== selfId && !existing.has(id)) selected.add(id);
  }
  return selected;
}
